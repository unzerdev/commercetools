import { ErrorInvalidOperation, Errorx } from '@commercetools/connect-payments-sdk';
import type { ModificationAction, ModificationResultView, Money, StoreConfig } from '../../../domain';
import { mintOperationReference, PaymentVersionConflict } from '../../../domain';
import type { Payment, ReservedLeg } from '../../ports';
import {
  applyModification,
  assertOperableByProvider,
  type ConcreteModificationAction,
  connectorStoreKey,
  forbidden,
  operationLeg,
  type OrchestrationDeps,
  paymentAmounts,
  providerPaymentId,
  releaseRefusedLeg,
  resolveModification,
  vendorAnsweredAndRefused,
  wrapProviderError,
} from '../shared';
import type { MerchantIntentCtx } from './merchant-intent-ctx';

/** The store the payment was created under; a payment naming none is not ours to act on. */
function derivedStoreKey(payment: Payment): string {
  const value = connectorStoreKey(payment);
  if (value === undefined) {
    throw forbidden('Not authorized for the requested payment.');
  }
  return value;
}

/** Exactly one action: headroom does not compose across a batch. */
function singleAction(data: { actions: ModificationAction[] }): ModificationAction {
  if (data.actions.length !== 1) {
    throw new ErrorInvalidOperation('A payment intent must carry exactly one action.');
  }
  return data.actions[0];
}

/** Reject an action beyond what the payment has left to move: capture and cancel against the capturable, refund against the refundable. */
function assertWithinHeadroom(payment: Payment, action: ConcreteModificationAction): void {
  const amounts = paymentAmounts(payment);

  const amount: Money | undefined = action.amount;
  if (amount === undefined) {
    if (amounts.capturable.centAmount <= 0) {
      throw new ErrorInvalidOperation('This payment has no authorized amount left to cancel.');
    }
    return;
  }

  const headroom: Money = action.action === 'refundPayment' ? amounts.refundable : amounts.capturable;

  if (amount.centAmount <= 0) {
    throw new ErrorInvalidOperation('The requested amount must be a positive cent amount.');
  }
  if (amount.currencyCode !== headroom.currencyCode) {
    throw new ErrorInvalidOperation(`The requested amount must be in ${headroom.currencyCode}.`);
  }
  if (amount.centAmount > headroom.centAmount) {
    throw new ErrorInvalidOperation(
      `The requested amount exceeds the remaining ${headroom.centAmount} ${headroom.currencyCode} available for this action.`,
    );
  }
}

/** A lost reservation race is a 409 answer, not a fault: nothing reached the vendor. */
function versionConflict(conflict: PaymentVersionConflict): Errorx {
  return new Errorx({
    code: 'ConcurrentModification',
    message: conflict.message,
    httpErrorStatus: 409,
    skipLog: true,
  });
}

/** Whether the wrapped error carries a definitive vendor refusal, read off its `cause`. */
function isDefiniteRefusal(error: unknown): boolean {
  return vendorAnsweredAndRefused(error instanceof Errorx ? error.cause : error);
}

interface RefundStep {
  amount?: Money;
  targetOperationId?: string;
}

/** The provider's split of one refund, refusal carried to the operator through the same error seam. */
async function planRefundSteps(
  amount: Money,
  payment: Payment,
  cfg: StoreConfig,
  ctx: MerchantIntentCtx,
  deps: OrchestrationDeps,
): Promise<RefundStep[]> {
  try {
    const slices = await deps.provider.modifications.planRefund(cfg, {
      providerPaymentId: providerPaymentId(payment),
      amount,
      fractionDigits: payment.amountPlanned.fractionDigits,
      ...(payment.paymentMethodInfo?.method ? { paymentMethod: payment.paymentMethodInfo.method } : {}),
    });
    return slices.map((slice) => ({
      amount: slice.amount,
      ...(slice.targetOperationId ? { targetOperationId: slice.targetOperationId } : {}),
    }));
  } catch (e) {
    throw wrapProviderError(e, 'planRefund', deps.provider.key, ctx.env.logger);
  }
}

/**
 * `POST /operations/payments/:id/intents`: resolve the action, guard it against the headroom, reserve its
 * leg under the version the guard judged, then dispatch. A refund may be several vendor operations, each
 * reserved under the version the previous one wrote.
 */
export async function applyMerchantIntent(
  ctx: MerchantIntentCtx,
  deps: OrchestrationDeps,
): Promise<ModificationResultView> {
  const intent = singleAction(ctx.data);
  const payment = await deps.ports.paymentStore.get(ctx.paymentId);
  const storeKey = derivedStoreKey(payment);

  const action = resolveModification(intent, payment, deps);
  assertWithinHeadroom(payment, action);

  assertOperableByProvider(payment);
  const cfg = await deps.ports.configResolver.resolve(storeKey);

  const steps: RefundStep[] =
    action.action === 'refundPayment' ? await planRefundSteps(action.amount, payment, cfg, ctx, deps) : [{}];

  if (steps.length === 0) {
    throw new Errorx({
      code: 'ProviderPlannedNoOperation',
      message: 'The payment provider resolved this refund to no operation.',
      httpErrorStatus: 500,
      privateMessage: `Provider '${deps.provider.key}' planned zero slices for a refund.`,
    });
  }

  let current = payment;
  let response: ModificationResultView | undefined;

  for (const [index, step] of steps.entries()) {
    const stepAction: ConcreteModificationAction =
      step.amount === undefined ? action : { ...action, amount: step.amount };
    const leg = operationLeg(stepAction, current);

    const operationReference = mintOperationReference(
      ctx.env.brand.paymentInterface,
      current.id,
      current.version,
      leg.type,
      leg.amount,
    );

    const reserved: ReservedLeg = { type: leg.type, interactionId: operationReference };

    try {
      await deps.ports.paymentStore.reserve({
        id: current.id,
        version: current.version,
        transaction: { ...reserved, amount: leg.amount },
      });
    } catch (error) {
      if (error instanceof PaymentVersionConflict) {
        throw versionConflict(error);
      }
      throw error;
    }

    try {
      response = await applyModification(
        {
          env: ctx.env,
          cfg,
          payment: current,
          action: stepAction,
          leg,
          operationReference,
          reserved: true,
          ...(step.targetOperationId ? { targetOperationId: step.targetOperationId } : {}),
        },
        deps,
      );
    } catch (error) {
      if (isDefiniteRefusal(error)) {
        await releaseRefusedLeg(current.id, reserved, ctx.env, deps);
      }
      throw error;
    }

    if (index < steps.length - 1) {
      current = await deps.ports.paymentStore.get(current.id);
    }
  }

  return response as ModificationResultView;
}
