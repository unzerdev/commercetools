import type { CtTransactionType, Money, ProviderEvent, SettlementKind, StoreConfig } from '../../../domain';
import {
  isDefaultScope,
  PaymentState,
  recordedTransactionType,
  resolveStateEffect,
  SETTLEMENT_KINDS,
} from '../../../domain';
import type { CorePorts, Payment } from '../../ports';
import { connectorStoreKey, type OrchestrationDeps, type OrchestrationLogger, recordPaymentOutcome } from '../shared';
import type { HandleWebhookCtx } from './handle-webhook-ctx';
import type { HandleWebhookResult } from './handle-webhook-result';

/** The in-flight Transaction type each settlement kind pertains to, so a refusal records the right `Failure`. */
const KIND_TRANSACTION_TYPE: Record<SettlementKind, CtTransactionType> = {
  'payment.pending_capture': 'Authorization',
  'payment.captured': 'Charge',
  'payment.cancelled': 'CancelAuthorization',
  'payment.refunded': 'Refund',
  'payment.rejected': 'Authorization',
  'payment.chargeback': 'Refund',
};

const isSettlementKind = (kind: string): kind is SettlementKind =>
  (SETTLEMENT_KINDS as readonly string[]).includes(kind);

/**
 * Partiality by arithmetic over the fetched payment's cumulative amounts, never the status code. A refund is
 * measured against what was captured, a capture or void against the authorized total; a missing figure defers.
 */
function downgradeToPartial(state: PaymentState, event: ProviderEvent): PaymentState {
  const isPartial = (settled: Money | undefined, whole: Money | undefined): boolean =>
    settled !== undefined && whole !== undefined && settled.centAmount < whole.centAmount;
  if (state === PaymentState.CAPTURED && isPartial(event.acquiredAmount, event.totalAmount)) {
    return PaymentState.PARTIALLY_CAPTURED;
  }
  if (state === PaymentState.REFUNDED && isPartial(event.cancelledAmount, event.acquiredAmount)) {
    return PaymentState.PARTIALLY_REFUNDED;
  }
  if (state === PaymentState.CANCELLED && isPartial(event.cancelledAmount, event.totalAmount)) {
    return PaymentState.PARTIALLY_CANCELLED;
  }
  return state;
}

/** Release the marker best-effort so a redelivery can re-process; a release failure never masks the original error. */
async function releaseMarkerQuietly(
  ports: CorePorts,
  key: string,
  logger: OrchestrationLogger,
  reason: string,
): Promise<void> {
  try {
    await ports.markerStore.release(key);
  } catch (releaseError) {
    logger.error('Webhook marker release failed', {
      key,
      reason,
      error: releaseError instanceof Error ? releaseError.message : String(releaseError),
    });
  }
}

/**
 * The CT Payment this event may reconcile onto, by the merchant reference or the platform payment id the
 * fetched payment echoes, with the store guard re-imposed: the payment's stamped store must be the one the
 * token gated, or on the default-scope route must resolve to the same credentials.
 */
async function findReconcilablePayment(
  event: ProviderEvent,
  ctx: HandleWebhookCtx,
  cfg: StoreConfig,
  deps: OrchestrationDeps,
): Promise<Payment | undefined> {
  const { ports } = deps;
  const defaultScope = isDefaultScope(ctx.storeKey);

  if (event.paymentRef && !defaultScope) {
    return ports.paymentStore.findByMerchantReference(event.paymentRef, ctx.storeKey);
  }

  const candidate = event.paymentRef
    ? await ports.paymentStore.findByMerchantReference(event.paymentRef)
    : await ports.paymentStore.findById(event.platformPaymentId ?? '');
  if (candidate === undefined) {
    return undefined;
  }

  const stampedStoreKey = connectorStoreKey(candidate);

  if (!defaultScope) {
    if (stampedStoreKey !== ctx.storeKey) {
      ctx.env.logger.warn('Webhook: the matched payment belongs to another store; ignoring', {
        storeKey: ctx.storeKey,
        paymentStoreKey: stampedStoreKey,
      });
      return undefined;
    }
    return candidate;
  }

  const paymentCfg = stampedStoreKey
    ? await ports.configResolver.resolve(stampedStoreKey)
    : await ports.configResolver.resolveDefault();

  if (paymentCfg.credentials.privateKey !== cfg.credentials.privateKey) {
    ctx.env.logger.warn('Webhook: default-scope event does not own the matched payment; ignoring', {
      paymentRef: event.paymentRef,
      storeKey: stampedStoreKey,
    });
    return undefined;
  }
  return candidate;
}

/**
 * The authoritative reconciler of a vendor webhook: token gate before any I/O, resolve config by the path
 * store key, parse (the provider reads the authoritative payment), gate on kind and anchors, claim the
 * idempotency marker, locate the CT Payment, dedupe against its transactions, record the Transaction.
 */
export async function handleWebhook(ctx: HandleWebhookCtx, deps: OrchestrationDeps): Promise<HandleWebhookResult> {
  const { env } = ctx;
  const { ports, provider } = deps;

  if (!ports.crypto.verifyWebhookUrlToken(ctx.storeKey, ctx.token)) {
    return { outcome: 'unauthorized' };
  }

  const cfg: StoreConfig = await ports.configResolver.resolve(ctx.storeKey);

  let event: ProviderEvent;
  try {
    event = await provider.webhook.parse(ctx.rawBody, cfg);
  } catch (e) {
    env.logger.error('Webhook body could not be interpreted', {
      storeKey: ctx.storeKey,
      byteLength: ctx.rawBody.length,
      bodyPrefix: ctx.rawBody.subarray(0, 120).toString('utf8'),
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  if (!isSettlementKind(event.kind)) {
    env.logger.info('Webhook: event kind not reconciled; answered 200 as a no-op', {
      kind: event.kind,
      storeKey: ctx.storeKey,
    });
    return { outcome: 'ignored' };
  }

  if (!event.paymentRef && !event.platformPaymentId) {
    env.logger.info('Webhook: event carries no reconciliation anchor; answered 200 as a no-op', {
      kind: event.kind,
      storeKey: ctx.storeKey,
      providerPaymentId: event.providerPaymentId,
    });
    return { outcome: 'ignored' };
  }

  if (!event.operationId) {
    env.logger.info('Webhook: no vendor operation for this kind on the payment; answered 200 as a no-op', {
      kind: event.kind,
      storeKey: ctx.storeKey,
      providerPaymentId: event.providerPaymentId,
    });
    return { outcome: 'ignored' };
  }

  const state = downgradeToPartial(provider.mapProviderStatus(event.rawStatus), event);
  const effect = resolveStateEffect(state);
  if (effect.kind !== 'transaction') {
    env.logger.info('Webhook: operation accepted but not settled yet; answered 200 as a no-op', {
      kind: event.kind,
      storeKey: ctx.storeKey,
      providerPaymentId: event.providerPaymentId,
      state,
    });
    return { outcome: 'ignored' };
  }

  const key = `${event.providerPaymentId}~${event.kind}~${event.operationId}`;
  const claimed = await ports.markerStore.claim(key);
  if (!claimed) {
    return { outcome: 'duplicate' };
  }

  try {
    const payment = await findReconcilablePayment(event, ctx, cfg, deps);
    if (payment === undefined) {
      await releaseMarkerQuietly(ports, key, env.logger, 'lookup-miss');
      env.logger.info('Webhook: no CT Payment for this anchor in this store yet; released marker for redelivery', {
        paymentRef: event.paymentRef,
        platformPaymentId: event.platformPaymentId,
        storeKey: ctx.storeKey,
        kind: event.kind,
      });
      return { outcome: 'ignored' };
    }

    const reflectedType = recordedTransactionType(effect.transaction, KIND_TRANSACTION_TYPE[event.kind]);
    const bareOperationId = event.operationId.slice(event.operationId.lastIndexOf('.') + 1);
    const settledIds = [event.operationId, bareOperationId, event.providerPaymentId];
    const reflectedIds = effect.transaction.state === 'Failure' ? [event.operationId, bareOperationId] : settledIds;
    if (
      payment.transactions.some(
        (t) =>
          t.type === reflectedType &&
          t.state === effect.transaction.state &&
          t.interactionId !== undefined &&
          reflectedIds.includes(t.interactionId),
      )
    ) {
      return { outcome: 'duplicate' };
    }

    await recordPaymentOutcome(
      payment,
      {
        effect,
        state,
        statusCode: event.statusCode,
        amount: event.amount ?? payment.amountPlanned,
        interactionId: event.operationId,
        pspReference: event.providerPaymentId,
        failureTransactionType: KIND_TRANSACTION_TYPE[event.kind],
      },
      env,
      ports,
    );

    return { outcome: 'processed' };
  } catch (e) {
    await releaseMarkerQuietly(ports, key, env.logger, 'processing-failure');
    throw e;
  }
}
