import type { Money } from '../common';

/** Cancel (void) an authorization: the named amount, or the whole remaining authorization when absent. */
export interface CancelModificationAction {
  action: 'cancelPayment';
  amount?: Money;
  /** Accepted on the wire for compatibility, read by nothing. */
  merchantReference?: string;
}
