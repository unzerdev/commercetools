import type { Money } from '../common';

/** Settle (capture) an authorized payment for the given amount. */
export interface CaptureModificationAction {
  action: 'capturePayment';
  amount: Money;
  /** Accepted on the wire for compatibility, read by nothing: the connector mints its own operation names. */
  merchantReference?: string;
}
