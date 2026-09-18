import { Errorx } from '@commercetools/connect-payments-sdk';
import type { OrderReader, OrderWithPayments, Payment } from '../../application/ports';
import { ctClient } from '../commercetools';

/** `OrderReader` over `ctClient.orders`: one call with the payments expanded; an unknown order id is a 404. */
export class OrderReaderAdapter implements OrderReader {
  public async getWithPayments(orderId: string): Promise<OrderWithPayments> {
    const order = await ctClient.orders.findWithPayments({ orderId });
    if (!order) {
      throw new Errorx({
        code: 'OrderNotFound',
        message: 'The requested order was not found.',
        httpErrorStatus: 404,
        skipLog: true,
      });
    }

    const payments = (order.paymentInfo?.payments ?? [])
      .map((reference) => reference.obj)
      .filter((payment): payment is Payment => payment !== undefined);

    return { id: order.id, payments };
  }
}
