/** The settlement kinds a provider webhook normalizes to and the reconciler acts on. */
export const SETTLEMENT_KINDS = [
  'payment.pending_capture',
  'payment.captured',
  'payment.cancelled',
  'payment.refunded',
  'payment.rejected',
  'payment.chargeback',
] as const;

export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];
