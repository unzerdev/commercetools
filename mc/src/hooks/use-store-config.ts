import { useQuery } from '@tanstack/react-query';
import { useProcessorClient } from '../processor';
import type { StoreConfigDto } from '../types/config';

/**
 * Reads the selected store's connector config from the processor into the session query cache
 * (`entry-point.tsx` defaults): one load per store, remounts and StrictMode's dev double-mount served
 * from memory. Mutations MUST keep the entry coherent — `persist()` writes the PUT response onto
 * `storeConfigQueryKey`, and disconnect re-reads through `queryClient.fetchQuery` on the same key —
 * so "read from memory" never means "stale config" (see `ConfigForm`).
 */

/** The cache key a store's config lives under — the contract between this hook and the mutations. */
export const storeConfigQueryKey = (storeKey: string) =>
  ['processor', 'store-config', storeKey] as const;

export type UseStoreConfigResult = {
  config?: StoreConfigDto;
  loading: boolean;
  error?: Error;
};

export const useStoreConfig = (storeKey: string): UseStoreConfigResult => {
  const client = useProcessorClient(storeKey);
  const query = useQuery({
    queryKey: storeConfigQueryKey(storeKey),
    queryFn: () => client.getStoreConfig(),
  });

  return {
    config: query.data,
    loading: query.isPending,
    error: query.error ?? undefined,
  };
};
