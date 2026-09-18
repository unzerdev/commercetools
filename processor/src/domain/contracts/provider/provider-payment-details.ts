import type { PaymentDetailsAmounts } from './payment-details-amounts';
import type { ProviderOperation } from './provider-operation';

/** One payment as the provider knows it; the merchant panel is fed from a single such read. */
export interface ProviderPaymentDetails {
  /** The vendor's status string, display only. */
  displayStatus: string;
  /** The provider's own order reference, display only. */
  orderId?: string;
  amounts?: PaymentDetailsAmounts;
  /** What the provider holds; an empty list decides nothing about what it does not report. */
  operations: ProviderOperation[];
}
