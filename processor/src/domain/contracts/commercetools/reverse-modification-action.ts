/** Reverse a payment; the core decides cancel-vs-refund from the transaction history. */
export interface ReverseModificationAction {
  action: 'reversePayment';
  /** Accepted on the wire for compatibility, read by nothing. */
  merchantReference?: string;
}
