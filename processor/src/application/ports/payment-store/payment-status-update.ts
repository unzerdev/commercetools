import type { PaymentStatusStateKey } from '../../../domain';

/** What the Merchant Center reads besides the transactions; a write with nothing set is a no-op. */
export interface PaymentStatusUpdate {
  interfaceCode?: string;
  interfaceText?: string;
  stateKey?: PaymentStatusStateKey;
}
