import type { PaymentStateDeclaration, PaymentStatusStateKey } from '../contracts';
import { PaymentState } from '../contracts';

/** The eight `PaymentState` states the connector registers, in lifecycle order. Bare keys: post-deploy adopts an existing one. */
export const paymentStateDeclarations: readonly PaymentStateDeclaration[] = [
  { key: 'new', type: 'PaymentState', name: { en: 'New' }, initial: true },
  { key: 'processing', type: 'PaymentState', name: { en: 'Processing' } },
  { key: 'completed', type: 'PaymentState', name: { en: 'Completed' } },
  { key: 'refunded', type: 'PaymentState', name: { en: 'Refunded' } },
  { key: 'partially-refunded', type: 'PaymentState', name: { en: 'Partially refunded' } },
  { key: 'cancelled', type: 'PaymentState', name: { en: 'Cancelled' } },
  { key: 'partially-cancelled', type: 'PaymentState', name: { en: 'Partially cancelled' } },
  { key: 'failed', type: 'PaymentState', name: { en: 'Failed' } },
];

/** The lifecycle → state key projection. `CHARGEBACK` writes nothing: no registered state describes it. */
const PAYMENT_STATE_TABLE: Readonly<Record<PaymentState, PaymentStatusStateKey | undefined>> = {
  [PaymentState.INITIAL]: 'new',
  [PaymentState.REDIRECTED]: 'new',
  [PaymentState.AUTHORIZED]: 'processing',
  [PaymentState.AUTHORIZATION_REQUESTED]: 'processing',
  [PaymentState.CAPTURE_REQUESTED]: 'processing',
  [PaymentState.REFUND_REQUESTED]: 'processing',
  [PaymentState.CANCEL_REQUESTED]: 'processing',
  [PaymentState.IN_REVIEW]: 'processing',
  [PaymentState.PARTIALLY_CAPTURED]: 'processing',
  [PaymentState.CAPTURED]: 'completed',
  [PaymentState.REFUNDED]: 'refunded',
  [PaymentState.PARTIALLY_REFUNDED]: 'partially-refunded',
  [PaymentState.CANCELLED]: 'cancelled',
  [PaymentState.PARTIALLY_CANCELLED]: 'partially-cancelled',
  [PaymentState.FAILED]: 'failed',
  [PaymentState.CHARGEBACK]: undefined,
};

type StateSubject = 'payment' | 'payment-pre-settlement' | 'operation';

/**
 * What a lifecycle state is a fact about: the payment as settled, the payment only until its money moves,
 * or one operation. Out-of-order webhooks and refused modifications must not restate a settled payment.
 */
const STATE_SUBJECT: Readonly<Record<PaymentState, StateSubject>> = {
  [PaymentState.INITIAL]: 'payment-pre-settlement',
  [PaymentState.REDIRECTED]: 'payment-pre-settlement',
  [PaymentState.AUTHORIZED]: 'payment-pre-settlement',
  [PaymentState.AUTHORIZATION_REQUESTED]: 'payment-pre-settlement',
  [PaymentState.IN_REVIEW]: 'payment-pre-settlement',
  [PaymentState.CAPTURED]: 'payment',
  [PaymentState.PARTIALLY_CAPTURED]: 'payment',
  [PaymentState.REFUNDED]: 'payment',
  [PaymentState.PARTIALLY_REFUNDED]: 'payment',
  [PaymentState.CANCELLED]: 'payment',
  [PaymentState.PARTIALLY_CANCELLED]: 'payment',
  [PaymentState.CHARGEBACK]: 'payment',
  [PaymentState.FAILED]: 'operation',
  [PaymentState.CAPTURE_REQUESTED]: 'operation',
  [PaymentState.REFUND_REQUESTED]: 'operation',
  [PaymentState.CANCEL_REQUESTED]: 'operation',
};

type PaymentLeg = { type: string; state: string };

const anythingSettled = (transactions: readonly PaymentLeg[]): boolean =>
  transactions.some((transaction) => transaction.state === 'Success');

/** Whether money moved: a settled charge, refund or void. A settled authorization is money reserved, not moved. */
const moneyHasMoved = (transactions: readonly PaymentLeg[]): boolean =>
  transactions.some((transaction) => transaction.state === 'Success' && transaction.type !== 'Authorization');

/** The `paymentStatus.state` key a lifecycle state reads as on this payment, or `undefined` to keep the current one. */
export const paymentStatusState = (
  state: PaymentState,
  transactions: readonly PaymentLeg[],
): PaymentStatusStateKey | undefined => {
  switch (STATE_SUBJECT[state]) {
    case 'payment':
      return PAYMENT_STATE_TABLE[state];
    case 'payment-pre-settlement':
      return moneyHasMoved(transactions) ? undefined : PAYMENT_STATE_TABLE[state];
    case 'operation':
      return anythingSettled(transactions) ? undefined : PAYMENT_STATE_TABLE[state];
  }
};
