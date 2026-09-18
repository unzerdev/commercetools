import type { Money } from '../common';

/** Refund a captured payment for the given amount. */
export interface RefundModificationAction {
  action: 'refundPayment';
  amount: Money;
  /** Accepted on the wire for compatibility, read by nothing. */
  merchantReference?: string;
  /** Accepted on the wire for compatibility, read by nothing. */
  transactionId?: string;
}
