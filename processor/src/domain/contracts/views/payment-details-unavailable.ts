/** The provider read failed for one payment; the panel renders the rest and offers a retry. */
export interface PaymentDetailsUnavailable {
  unavailable: true;
  /** Operator-facing, secret-free. */
  reason: string;
}
