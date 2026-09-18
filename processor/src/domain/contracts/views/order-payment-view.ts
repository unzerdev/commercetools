import type { Money } from '../common';
import type { ProviderPaymentDetails } from '../provider';
import type { PaymentDetailsUnavailable } from './payment-details-unavailable';

/** One connector-owned payment on the order panel: commercetools truth plus the provider's view of it. */
export interface OrderPaymentView {
  id: string;
  providerPaymentId?: string;
  merchantReference?: string;
  inReview: boolean;
  paymentMethod?: string;
  amountPlanned: Money;
  fractionDigits: number;
  capturableAmount: Money;
  refundableAmount: Money;
  details: ProviderPaymentDetails | PaymentDetailsUnavailable;
}
