import type {
  BookingMode,
  CtTransactionEffect,
  CtTransactionState,
  CtTransactionType,
  Money,
  StateEffect,
} from '../contracts';
import { PaymentState } from '../contracts';

const NO_OP: StateEffect = { kind: 'no-op' };

const transaction = (type: CtTransactionType, state: CtTransactionState, reviewField?: boolean): StateEffect =>
  reviewField === undefined
    ? { kind: 'transaction', transaction: { type, state } }
    : { kind: 'transaction', transaction: { type, state }, reviewField };

/** The exhaustive state → CT effect table; a no-op is a deliberate non-transition awaiting the settling webhook. */
const STATE_TABLE: Record<PaymentState, StateEffect> = {
  [PaymentState.INITIAL]: NO_OP,
  [PaymentState.REDIRECTED]: NO_OP,
  [PaymentState.AUTHORIZATION_REQUESTED]: NO_OP,
  [PaymentState.CAPTURE_REQUESTED]: NO_OP,
  [PaymentState.REFUND_REQUESTED]: NO_OP,
  [PaymentState.CANCEL_REQUESTED]: NO_OP,
  [PaymentState.AUTHORIZED]: transaction('Authorization', 'Success'),
  [PaymentState.CAPTURED]: transaction('Charge', 'Success'),
  [PaymentState.REFUNDED]: transaction('Refund', 'Success'),
  [PaymentState.CHARGEBACK]: transaction('Refund', 'Success'),
  [PaymentState.CANCELLED]: transaction('CancelAuthorization', 'Success'),
  [PaymentState.FAILED]: transaction('Authorization', 'Failure'),
  [PaymentState.IN_REVIEW]: transaction('Authorization', 'Pending', true),
  [PaymentState.PARTIALLY_CAPTURED]: transaction('Charge', 'Success'),
  [PaymentState.PARTIALLY_REFUNDED]: transaction('Refund', 'Success'),
  [PaymentState.PARTIALLY_CANCELLED]: transaction('CancelAuthorization', 'Success'),
};

/** The CT effect of a payment state; throws for a value outside the vocabulary rather than dropping it silently. */
export const resolveStateEffect = (state: PaymentState): StateEffect => {
  const effect = STATE_TABLE[state];
  if (!effect) {
    throw new Error(`Unmapped payment state '${state}': no entry in the state machine table.`);
  }
  return effect;
};

/** The CT type of the leg a pay call opens under each booking kind. */
const OPENED_LEG_TYPE: Readonly<Record<BookingMode, CtTransactionType>> = {
  authorize: 'Authorization',
  charge: 'Charge',
};

/** The states in which a pay answer only says the operation is open; the return leg or the webhook settles it. */
const OPEN_STATES: ReadonlySet<PaymentState> = new Set([
  PaymentState.INITIAL,
  PaymentState.REDIRECTED,
  PaymentState.AUTHORIZATION_REQUESTED,
  PaymentState.CAPTURE_REQUESTED,
]);

/**
 * The create leg's effect: the table's, or a `Pending` leg of the booked kind while the operation is only open.
 * The table's no-op stays right for the webhook, which must not settle what the vendor has not; the create leg
 * differs because a payment that shows no leg at all cannot be told apart from one that was never attempted, and
 * a host verifying the payment right after the pay call needs the opened operation on record. The leg is keyed on
 * the vendor's operation id, so the settling write later lands on it instead of beside it.
 */
export const openedOperationEffect = (state: PaymentState, bookingMode: BookingMode): StateEffect => {
  const effect = resolveStateEffect(state);
  return effect.kind === 'no-op' && OPEN_STATES.has(state)
    ? transaction(OPENED_LEG_TYPE[bookingMode], 'Pending')
    : effect;
};

/** The type a Transaction is recorded under: a `Failure` takes the in-flight operation's type when one is given. */
export const recordedTransactionType = (
  transaction: CtTransactionEffect,
  failureTransactionType: CtTransactionType | undefined,
): CtTransactionType =>
  transaction.state === 'Failure' && failureTransactionType ? failureTransactionType : transaction.type;

/** The `updatePayment` fragment every write path shares: the vendor payment id and, for a transition, the Transaction. */
export function buildPaymentUpdate(
  effect: StateEffect,
  opts: {
    amount: Money;
    interactionId: string;
    pspReference?: string;
    failureTransactionType?: CtTransactionType;
  },
): {
  pspReference?: string;
  transaction?: {
    type: CtTransactionType;
    state: CtTransactionState;
    amount: Money;
    interactionId: string;
  };
} {
  const pspReferencePart = opts.pspReference ? { pspReference: opts.pspReference } : {};
  if (effect.kind !== 'transaction') {
    return pspReferencePart;
  }
  const type = recordedTransactionType(effect.transaction, opts.failureTransactionType);
  return {
    ...pspReferencePart,
    transaction: { type, state: effect.transaction.state, amount: opts.amount, interactionId: opts.interactionId },
  };
}
