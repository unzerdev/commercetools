import { ErrorGeneral, ErrorInvalidOperation, Errorx } from '@commercetools/connect-payments-sdk';
import type {
  CancelModificationAction,
  CaptureModificationAction,
  CtTransactionType,
  ModificationAction,
  ModificationRequest,
  ModificationResultView,
  Money,
  OperationReference,
  OperationResult,
  RefundModificationAction,
  StateEffect,
  StoreConfig,
} from '../../../domain';
import { mintOperationReference, PaymentModificationStatus, PaymentState, resolveStateEffect } from '../../../domain';
import type { Payment, ReservedLeg } from '../../ports';
import type { OrchestrationCtx, OrchestrationDeps, OrchestrationEnv } from './env';
import { wrapProviderError } from './errors';
import { paymentAmounts } from './payment-amounts';
import { writePaymentStatus } from './payment-status-write';
import { recordPaymentOutcome } from './record-payment-outcome';

/** The modification the vendor is actually asked to perform; `reversePayment` is resolved into one first. */
export type ConcreteModificationAction =
  CaptureModificationAction | RefundModificationAction | CancelModificationAction;

/** The CT leg an operation moves. */
export interface OperationLeg {
  type: CtTransactionType;
  amount: Money;
}

/** What the shared dispatch runs on: the resolved store config, the named operation and whether its leg is already reserved. */
export interface ModificationCtx extends OrchestrationCtx {
  cfg: StoreConfig;
  leg: OperationLeg;
  operationReference: OperationReference;
  /** `true` on the Merchant Center path, which wrote the leg before calling the vendor. */
  reserved: boolean;
  /** The vendor operation a refund slice draws on. */
  targetOperationId?: string;
}

/** The vendor payment id lives on the CT Payment's `interfaceId`. */
export function providerPaymentId(payment: Payment): string {
  if (!payment.interfaceId) {
    throw new ErrorInvalidOperation('The payment has no provider reference (interfaceId) to operate on.');
  }
  return payment.interfaceId;
}

/** Refuse a payment with no vendor id before a leg is reserved for it. */
export function assertOperableByProvider(payment: Payment): void {
  providerPaymentId(payment);
}

/** Reverse: refund when money settled, cancel when only authorized, refuse when nothing is there. */
function resolveReversal(payment: Payment, deps: OrchestrationDeps): ConcreteModificationAction {
  const { paymentStore } = deps.ports;

  const hasCharge = paymentStore.hasTransactionInState({ payment, transactionType: 'Charge', states: ['Success'] });
  const hasRefund = paymentStore.hasTransactionInState({
    payment,
    transactionType: 'Refund',
    states: ['Success', 'Pending'],
  });
  const hasCancelAuthorization = paymentStore.hasTransactionInState({
    payment,
    transactionType: 'CancelAuthorization',
    states: ['Success', 'Pending'],
  });

  const wasPaymentReverted = hasRefund || hasCancelAuthorization;

  if (hasCharge && !wasPaymentReverted) {
    return { action: 'refundPayment', amount: payment.amountPlanned };
  }

  const hasAuthorization = paymentStore.hasTransactionInState({
    payment,
    transactionType: 'Authorization',
    states: ['Success'],
  });
  if (hasAuthorization && !wasPaymentReverted) {
    return { action: 'cancelPayment' };
  }

  throw new ErrorInvalidOperation('There is no successful payment transaction to reverse.');
}

/** A merchant action as the operation the vendor will perform. */
export function resolveModification(
  action: ModificationAction,
  payment: Payment,
  deps: OrchestrationDeps,
): ConcreteModificationAction {
  switch (action.action) {
    case 'capturePayment':
    case 'refundPayment':
    case 'cancelPayment':
      return action;
    case 'reversePayment':
      return resolveReversal(payment, deps);
    default:
      throw new ErrorInvalidOperation('Operation not supported.');
  }
}

/** The leg an operation moves; a cancel with no amount voids the whole capture headroom. */
export function operationLeg(action: ConcreteModificationAction, payment: Payment): OperationLeg {
  switch (action.action) {
    case 'capturePayment':
      return { type: 'Charge', amount: action.amount };
    case 'refundPayment':
      return { type: 'Refund', amount: action.amount };
    default:
      return { type: 'CancelAuthorization', amount: action.amount ?? paymentAmounts(payment).capturable };
  }
}

function callVendor(
  action: ConcreteModificationAction,
  cfg: StoreConfig,
  vendorPaymentId: string,
  operationReference: OperationReference,
  fractionDigits: number,
  deps: OrchestrationDeps,
  extra: { targetOperationId?: string; merchantOrderId?: string; paymentMethod?: string } = {},
): Promise<OperationResult> {
  switch (action.action) {
    case 'capturePayment':
      return deps.provider.modifications.capture(cfg, {
        providerPaymentId: vendorPaymentId,
        amount: action.amount.centAmount,
        fractionDigits,
        operationReference,
      });
    case 'refundPayment':
      return deps.provider.modifications.refund(cfg, {
        providerPaymentId: vendorPaymentId,
        amount: { centAmount: action.amount.centAmount, currencyCode: action.amount.currencyCode },
        ...(extra.targetOperationId ? { targetOperationId: extra.targetOperationId } : {}),
        ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}),
        fractionDigits,
        operationReference,
      });
    default:
      return deps.provider.modifications.cancel(cfg, {
        providerPaymentId: vendorPaymentId,
        ...(action.amount ? { amount: action.amount } : {}),
        ...(extra.merchantOrderId ? { merchantOrderId: extra.merchantOrderId } : {}),
        ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}),
        fractionDigits,
        operationReference,
      });
  }
}

type TransactionEffect = Extract<StateEffect, { kind: 'transaction' }>;

/** An accepted-but-unsettled modification lands a `Pending` leg of its own type, so the headroom counts it. */
function pendingUntilSettled(effect: StateEffect, operationType: CtTransactionType): TransactionEffect {
  return effect.kind === 'transaction'
    ? effect
    : { kind: 'transaction', transaction: { type: operationType, state: 'Pending' } };
}

function outcomeFor(effect: TransactionEffect): PaymentModificationStatus {
  switch (effect.transaction.state) {
    case 'Success':
      return PaymentModificationStatus.APPROVED;
    case 'Failure':
      return PaymentModificationStatus.REJECTED;
    default:
      return PaymentModificationStatus.RECEIVED;
  }
}

/** Hand reserved money back after a definite refusal; a failed release is logged, never rethrown over the refusal. */
export async function releaseRefusedLeg(
  paymentId: string,
  reserved: ReservedLeg,
  env: OrchestrationEnv,
  deps: OrchestrationDeps,
): Promise<void> {
  try {
    await deps.ports.paymentStore.release(paymentId, reserved);
  } catch (error) {
    env.logger.error('A refused operation could not be released; its reservation stands and holds the headroom shut', {
      paymentId,
      transactionType: reserved.type,
      interactionId: reserved.interactionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A leg the vendor did not name stays under our name and `Pending`; only the operator's runbook clears it. */
function leaveLegStanding(paymentId: string, leg: ReservedLeg, env: OrchestrationEnv): void {
  env.logger.error('The provider answered without naming the operation; the leg stays and the headroom stays shut', {
    paymentId,
    transactionType: leg.type,
    interactionId: leg.interactionId,
  });
}

/** Close the reserved leg with the vendor's answer: release a refusal, settle a named operation, leave an unnamed one. */
async function closeReservedLeg(
  paymentId: string,
  reserved: ReservedLeg,
  effect: TransactionEffect,
  providerOperationId: string | undefined,
  env: OrchestrationEnv,
  deps: OrchestrationDeps,
): Promise<void> {
  if (effect.transaction.state === 'Failure') {
    await releaseRefusedLeg(paymentId, reserved, env, deps);
    return;
  }
  if (providerOperationId === undefined) {
    leaveLegStanding(paymentId, reserved, env);
    return;
  }
  await deps.ports.paymentStore.settle(paymentId, reserved, {
    state: effect.transaction.state === 'Success' ? 'Success' : 'Pending',
    providerOperationId,
  });
}

/** Partiality derived from the pre-operation headroom minus what this operation took. */
function downgradeToPartial(
  state: PaymentState,
  action: ConcreteModificationAction,
  leg: OperationLeg,
  payment: Payment,
): PaymentState {
  const amounts = paymentAmounts(payment);
  const leftOver = (headroom: Money): boolean => headroom.centAmount - leg.amount.centAmount > 0;

  if (state === PaymentState.REFUNDED && action.action === 'refundPayment' && leftOver(amounts.refundable)) {
    return PaymentState.PARTIALLY_REFUNDED;
  }
  if (state === PaymentState.CANCELLED && action.action === 'cancelPayment' && leftOver(amounts.capturable)) {
    return PaymentState.PARTIALLY_CANCELLED;
  }
  if (state === PaymentState.CAPTURED && action.action === 'capturePayment' && leftOver(amounts.capturable)) {
    return PaymentState.PARTIALLY_CAPTURED;
  }
  return state;
}

/**
 * Record the vendor's answer. The reserved leg is settled or released; an unreserved one is appended under the
 * vendor's operation id, or under our own name and `Pending` when the vendor named none.
 */
async function applyOperationResult(
  ctx: ModificationCtx & { payment: Payment; action: ConcreteModificationAction },
  result: OperationResult,
  vendorPaymentId: string,
  deps: OrchestrationDeps,
): Promise<ModificationResultView> {
  const { action, leg, payment, env } = ctx;
  const state = downgradeToPartial(deps.provider.mapProviderStatus(result.rawStatus), action, leg, payment);
  const effect = pendingUntilSettled(resolveStateEffect(state), leg.type);
  const { providerOperationId } = result;

  if (ctx.reserved) {
    if (effect.reviewField) {
      await deps.ports.paymentStore.setReviewFlag(payment.id);
    }
    await closeReservedLeg(
      payment.id,
      { type: leg.type, interactionId: ctx.operationReference },
      effect,
      providerOperationId,
      env,
      deps,
    );
    await writePaymentStatus(payment, state, result.statusCode, env, deps.ports);
  } else {
    const refused = effect.transaction.state === 'Failure';
    const standing: TransactionEffect =
      providerOperationId !== undefined || refused
        ? effect
        : { ...effect, transaction: { ...effect.transaction, state: 'Pending' } };
    await recordPaymentOutcome(
      payment,
      {
        effect: standing,
        state,
        statusCode: result.statusCode,
        amount: leg.amount,
        interactionId: providerOperationId ?? ctx.operationReference,
        failureTransactionType: leg.type,
      },
      env,
      deps.ports,
    );
    if (providerOperationId === undefined && !refused) {
      leaveLegStanding(payment.id, { type: leg.type, interactionId: ctx.operationReference }, env);
    }
  }

  return { outcome: outcomeFor(effect), pspReference: providerOperationId ?? vendorPaymentId };
}

/** A commercetools failure after the vendor answered is named for what broke, so nobody re-sends a performed operation. */
async function recordOperationResult(
  ctx: ModificationCtx & { payment: Payment; action: ConcreteModificationAction },
  result: OperationResult,
  vendorPaymentId: string,
  deps: OrchestrationDeps,
): Promise<ModificationResultView> {
  try {
    return await applyOperationResult(ctx, result, vendorPaymentId, deps);
  } catch (error) {
    if (error instanceof Errorx) {
      throw error;
    }
    ctx.env.logger.error(`Recording the provider's answer to '${ctx.action.action}' in commercetools failed`, {
      paymentId: ctx.payment.id,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new ErrorGeneral('The payment provider answered, but recording the answer in commercetools failed.', {
      cause: error,
      privateMessage: `commercetools write failed after provider '${deps.provider.key}' answered '${ctx.action.action}'.`,
    });
  }
}

/** The one dispatch both principals run over an already-loaded payment and an already-resolved action. */
export async function applyModification(
  ctx: ModificationCtx & { payment: Payment; action: ConcreteModificationAction },
  deps: OrchestrationDeps,
): Promise<ModificationResultView> {
  const { action, payment } = ctx;
  const vendorPaymentId = providerPaymentId(payment);

  let result: OperationResult;
  try {
    result = await callVendor(
      action,
      ctx.cfg,
      vendorPaymentId,
      ctx.operationReference,
      ctx.payment.amountPlanned.fractionDigits,
      deps,
      {
        ...(ctx.targetOperationId ? { targetOperationId: ctx.targetOperationId } : {}),
        merchantOrderId: payment.id,
        ...(payment.paymentMethodInfo?.method ? { paymentMethod: payment.paymentMethodInfo.method } : {}),
      },
    );
  } catch (e) {
    throw wrapProviderError(e, action.action, deps.provider.key, ctx.env.logger);
  }

  return recordOperationResult(ctx, result, vendorPaymentId, deps);
}

/** `POST /operations/payment-intents/:id` (Checkout): reserves nothing, so the money is in the operation's name. */
export async function modifyPayment(
  ctx: OrchestrationCtx & { storeKey: string; paymentId: string; data: ModificationRequest },
  deps: OrchestrationDeps,
): Promise<ModificationResultView> {
  const [intent] = ctx.data.actions;
  if (!intent) {
    throw new ErrorInvalidOperation('Operation not supported.');
  }

  const payment = await deps.ports.paymentStore.get(ctx.paymentId);
  const action = resolveModification(intent, payment, deps);
  const leg = operationLeg(action, payment);
  const operationReference = mintOperationReference(
    ctx.env.brand.paymentInterface,
    payment.id,
    payment.version,
    leg.type,
    leg.amount,
  );
  const cfg = await deps.ports.configResolver.resolve(ctx.storeKey);

  return applyModification({ env: ctx.env, cfg, payment, action, leg, operationReference, reserved: false }, deps);
}
