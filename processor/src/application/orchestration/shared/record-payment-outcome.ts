import type { CtTransactionType, Money, PaymentState, ProviderStatusCode, StateEffect } from '../../../domain';
import { buildPaymentUpdate } from '../../../domain';
import type { CorePorts, Payment, UpdatePaymentArgs } from '../../ports';
import type { OrchestrationEnv } from './env';
import { writePaymentStatus } from './payment-status-write';

/** One learned outcome to record on a CT Payment. */
export interface PaymentOutcome {
  effect: StateEffect;
  state: PaymentState;
  statusCode?: ProviderStatusCode;
  amount: Money;
  interactionId: string;
  pspReference?: string;
  failureTransactionType?: CtTransactionType;
  customFields?: UpdatePaymentArgs['customFields'];
}

/**
 * The one way an outcome lands on a CT Payment: the review flag first (a merge, and the signal no webhook
 * re-sets), then the Transaction and custom fields, then the status line last and non-throwing.
 */
export async function recordPaymentOutcome(
  payment: Payment,
  outcome: PaymentOutcome,
  env: OrchestrationEnv,
  ports: CorePorts,
): Promise<void> {
  if (outcome.effect.kind === 'transaction' && outcome.effect.reviewField) {
    await ports.paymentStore.setReviewFlag(payment.id);
  }

  await ports.paymentStore.update({
    id: payment.id,
    ...buildPaymentUpdate(outcome.effect, {
      amount: outcome.amount,
      interactionId: outcome.interactionId,
      ...(outcome.pspReference ? { pspReference: outcome.pspReference } : {}),
      ...(outcome.failureTransactionType ? { failureTransactionType: outcome.failureTransactionType } : {}),
    }),
    ...(outcome.customFields ? { customFields: outcome.customFields } : {}),
  });

  await writePaymentStatus(payment, outcome.state, outcome.statusCode, env, ports);
}
