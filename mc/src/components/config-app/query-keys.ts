import type { StoreMode } from './config-model';

/**
 * The cache key a store's payment methods live under, scoped by environment: the catalogue is read from
 * the selected environment's keypair, so sandbox and live cache independently.
 */
export const paymentMethodsQueryKey = (storeKey: string, mode: StoreMode) =>
  ['processor', 'payment-methods', storeKey, mode] as const;
