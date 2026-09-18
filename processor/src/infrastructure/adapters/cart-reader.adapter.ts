import type { Cart, CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import type { CartReader, PaymentAmount } from '../../application/ports';
import { getCartIdFromContext } from '../bootstrap/libs/fastify/context/context';

/** `CartReader` over the SDK cart service and the request context. */
export class CartReaderAdapter implements CartReader {
  constructor(private readonly ctCartService: CommercetoolsCartService) {}

  public currentCartId(): string {
    return getCartIdFromContext();
  }

  public getCart(id: string): Promise<Cart> {
    return this.ctCartService.getCart({ id });
  }

  public getPaymentAmount(cart: Cart): Promise<PaymentAmount> {
    return this.ctCartService.getPaymentAmount({ cart });
  }

  public async addPayment(resource: { id: string; version: number }, paymentId: string): Promise<void> {
    await this.ctCartService.addPayment({ resource, paymentId });
  }
}
