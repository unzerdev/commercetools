import type { Cart } from '@commercetools/connect-payments-sdk';
import type { PaymentAmount } from './payment-amount';

/** The session cart: read it, derive its planned amount, associate a payment. */
export interface CartReader {
  currentCartId(): string;

  getCart(id: string): Promise<Cart>;

  getPaymentAmount(cart: Cart): Promise<PaymentAmount>;

  addPayment(resource: { id: string; version: number }, paymentId: string): Promise<void>;
}
