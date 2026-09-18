import type { OrderPaymentView } from './order-payment-view';

/** The whole order payments panel in one read. */
export interface OrderPaymentsView {
  payments: OrderPaymentView[];
}
