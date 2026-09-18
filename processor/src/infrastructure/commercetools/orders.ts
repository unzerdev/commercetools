import { paymentSDK } from '../bootstrap/payment-sdk';
import { isNotFound } from './errors';
import type { Execute } from './types';

export type FindOrderArgs = { orderId: string };

type OrderBody = Execute<ReturnType<ReturnType<ReturnType<typeof paymentSDK.ctAPI.client.orders>['withId']>['get']>>;

/** An order with `paymentInfo.payments[*]` expanded, or `null` on a 404. */
async function findWithPayments({ orderId }: FindOrderArgs): Promise<OrderBody | null> {
  try {
    const { body } = await paymentSDK.ctAPI.client
      .orders()
      .withId({ ID: orderId })
      .get({ queryArgs: { expand: ['paymentInfo.payments[*]'] } })
      .execute();
    return body;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export const orders = { findWithPayments };
