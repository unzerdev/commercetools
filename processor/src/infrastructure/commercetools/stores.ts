import { paymentSDK } from '../bootstrap/payment-sdk';
import { isNotFound } from './errors';
import type { Execute } from './types';

export type GetStoreArgs = { key: string };

type StoreBody = Execute<ReturnType<ReturnType<ReturnType<typeof paymentSDK.ctAPI.client.stores>['withKey']>['get']>>;
type ProjectBody = Execute<ReturnType<typeof paymentSDK.ctAPI.client.get>>;

/** One store; a missing key raises the 404. */
async function get({ key }: GetStoreArgs): Promise<StoreBody> {
  const { body } = await paymentSDK.ctAPI.client.stores().withKey({ key }).get().execute();
  return body;
}

/** One store, or `null` on a 404. */
async function find(args: GetStoreArgs): Promise<StoreBody | null> {
  try {
    return await get(args);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function list(): Promise<StoreBody[]> {
  const { body } = await paymentSDK.ctAPI.client.stores().get().execute();
  return body.results;
}

async function projectSettings(): Promise<ProjectBody> {
  const { body } = await paymentSDK.ctAPI.client.get().execute();
  return body;
}

export const stores = { get, find, list, projectSettings };
