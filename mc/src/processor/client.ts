/**
 * The MC app's only channel to the processor: one method per `/operations/*` endpoint, each sending a
 * forwarded request and typing what comes back. No business logic, no caching, no wording of its own -
 * a failure the processor did not name is a `ProcessorError` carrying an intl id for the render site.
 *
 * `storeKey` is fixed for the hook's lifetime (the selected store) and rides every call as the
 * `X-Store-Key` forward header, so the processor reads and writes that store's config.
 */

import { useMemo } from 'react';
import type {
  PaymentMethodsDto,
  StoreConfigDto,
  StoreMode,
  StoreReferenceData,
  StoreSummary,
} from '../types/config';
import { forwardRequest } from './forward-request';
import { useProcessorUrl } from './processor-url';
import { operationUri } from './request';

export type ProcessorClient = {
  getStoreConfig: () => Promise<StoreConfigDto>;
  putStoreConfig: (body: StoreConfigDto) => Promise<StoreConfigDto>;
  deleteConnection: (mode: StoreMode) => Promise<void>;
  getPaymentMethods: (mode?: StoreMode) => Promise<PaymentMethodsDto>;
  putPaymentMethods: (
    body: PaymentMethodsDto,
    mode?: StoreMode
  ) => Promise<PaymentMethodsDto>;
  getStoreReferenceData: () => Promise<StoreReferenceData>;
  getStores: () => Promise<StoreSummary[]>;
};
export const useProcessorClient = (
  storeKey: string | undefined
): ProcessorClient => {
  const externalApiUrl = useProcessorUrl().url ?? '';

  return useMemo<ProcessorClient>(() => {
    const uri = (endpoint: string) => operationUri(externalApiUrl, endpoint);
    // The payment-methods surface is environment-scoped: `mode` picks which environment is read or
    // written; omitted, the store's persisted active environment stands.
    const paymentMethodsUri = (mode?: StoreMode) =>
      mode ? `${uri('payment-methods')}?mode=${mode}` : uri('payment-methods');

    return {
      getStoreConfig: () =>
        forwardRequest<StoreConfigDto>({
          uri: uri('store-config'),
          method: 'GET',
          storeKey,
        }),

      putStoreConfig: (body) =>
        forwardRequest<StoreConfigDto>({
          uri: uri('store-config'),
          method: 'PUT',
          storeKey,
          body,
        }),

      deleteConnection: (mode) =>
        forwardRequest<void>({
          uri: `${uri('store-config')}?mode=${mode}`,
          method: 'DELETE',
          storeKey,
        }),

      getPaymentMethods: (mode) =>
        forwardRequest<PaymentMethodsDto>({
          uri: paymentMethodsUri(mode),
          method: 'GET',
          storeKey,
        }),

      putPaymentMethods: (body, mode) =>
        forwardRequest<PaymentMethodsDto>({
          uri: paymentMethodsUri(mode),
          method: 'PUT',
          storeKey,
          body,
        }),

      getStoreReferenceData: () =>
        forwardRequest<StoreReferenceData>({
          uri: uri('store-reference-data'),
          method: 'GET',
          storeKey,
        }),

      // The store list is connector-wide, not store-scoped, so it deliberately omits X-Store-Key.
      getStores: () =>
        forwardRequest<StoreSummary[]>({
          uri: uri('stores'),
          method: 'GET',
          storeKey: undefined,
        }),
    };
  }, [externalApiUrl, storeKey]);
};
