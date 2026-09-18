import { paymentSDK } from '../bootstrap/payment-sdk';
import { isNotFound } from './errors';
import type { Execute } from './types';

export type FindCustomerArgs = { id: string };

type CustomerBody = Execute<
  ReturnType<ReturnType<ReturnType<typeof paymentSDK.ctAPI.client.customers>['withId']>['get']>
>;

/** One customer, or `null` when the id names none. */
async function find({ id }: FindCustomerArgs): Promise<CustomerBody | null> {
  try {
    const { body } = await paymentSDK.ctAPI.client.customers().withId({ ID: id }).get().execute();
    return body;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export const customers = { find };
