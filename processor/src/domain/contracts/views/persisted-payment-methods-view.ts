import type { PaymentMethodConfig } from '../config';

/** The persisted method list echoed back after a save. */
export interface PersistedPaymentMethodsView {
  paymentMethods: PaymentMethodConfig[];
}
