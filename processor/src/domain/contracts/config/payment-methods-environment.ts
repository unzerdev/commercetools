import type { PaymentMethodConfig } from './payment-method-config';

/** One environment's persisted method configuration: which methods the merchant enabled, and how. */
export interface PaymentMethodsEnvironment {
  paymentMethods: PaymentMethodConfig[];
}
