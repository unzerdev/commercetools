import type { PaymentMethodView } from './payment-method-view';

/** The merged, catalogue-ordered merchant methods view. */
export interface PaymentMethodsView {
  paymentMethods: PaymentMethodView[];
}
