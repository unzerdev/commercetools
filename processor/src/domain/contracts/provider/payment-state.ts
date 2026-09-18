/** The PSP-agnostic payment lifecycle vocabulary. A const object so mapping tables can be total over it. */
export const PaymentState = {
  /** Payment created; no vendor interaction yet. */
  INITIAL: 'INITIAL',
  /** Shopper sent to a hosted page or 3DS challenge; awaiting return. */
  REDIRECTED: 'REDIRECTED',
  /** Authorization submitted; outcome pending. */
  AUTHORIZATION_REQUESTED: 'AUTHORIZATION_REQUESTED',
  /** Funds held, not yet captured. */
  AUTHORIZED: 'AUTHORIZED',
  /** Capture submitted; settlement pending. */
  CAPTURE_REQUESTED: 'CAPTURE_REQUESTED',
  /** Full amount captured. */
  CAPTURED: 'CAPTURED',
  /** Refund submitted; processing pending. */
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  /** Void submitted; processing pending. */
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  /** Full captured amount refunded. */
  REFUNDED: 'REFUNDED',
  /** Terminal failure: declined or errored. */
  FAILED: 'FAILED',
  /** Held by the vendor for review - for Unzer, a check on whether the customer overpaid. */
  IN_REVIEW: 'IN_REVIEW',
  /** Authorization voided before capture. */
  CANCELLED: 'CANCELLED',
  /** Part of the captured amount refunded. */
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  /** Part of the authorized amount voided. */
  PARTIALLY_CANCELLED: 'PARTIALLY_CANCELLED',
  /** Part of the authorized amount captured. */
  PARTIALLY_CAPTURED: 'PARTIALLY_CAPTURED',
  /** Captured funds reversed by the shopper's bank; a dispute, not a refund. */
  CHARGEBACK: 'CHARGEBACK',
} as const;

// eslint-disable-next-line no-redeclare -- intentional value+type merge (the const-object enum idiom)
export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState];
