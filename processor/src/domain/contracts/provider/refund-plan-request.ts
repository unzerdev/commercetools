import type { Money } from '../common';

/** Asked before a refund is performed: how many vendor operations it will be, and for how much each. */
export interface RefundPlanRequest {
  providerPaymentId: string;
  amount: Money;
  fractionDigits: number;
  paymentMethod?: string;
}
