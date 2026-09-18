import type { Money } from '../common';

/** The payment's cumulative amounts as the provider reports them, display only; an unreported figure is omitted. */
export interface PaymentDetailsAmounts {
  total?: Money;
  authorized?: Money;
  charged?: Money;
  cancelled?: Money;
  refunded?: Money;
}
