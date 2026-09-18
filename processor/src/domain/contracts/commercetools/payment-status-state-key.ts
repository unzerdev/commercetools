/** The `paymentStatus.state` keys this connector registers as commercetools `State`s. */
export type PaymentStatusStateKey =
  | 'new'
  | 'processing'
  | 'completed'
  | 'refunded'
  | 'partially-refunded'
  | 'cancelled'
  | 'partially-cancelled'
  | 'failed';
