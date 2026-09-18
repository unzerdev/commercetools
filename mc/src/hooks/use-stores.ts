import { useQuery } from '@tanstack/react-query';
import { useProcessorClient } from '../processor';
import type { StoreSummary } from '../types/config';

/**
 * Reads the connector's configurable stores (key + display name) from the processor so the config
 * screen can render its own store selector. The list is connector-wide and needed BEFORE any store is
 * selected, so the client is created without a selected store — `getStores` ignores the store key. The
 * MC app makes ZERO direct commercetools calls: reference data all travels via the processor.
 *
 * Cached under a session-lifetime query (`entry-point.tsx` defaults): the list loads ONCE — remounts
 * and StrictMode's dev double-mount are served from memory, never a second network call.
 */

export type UseStoresResult = {
  stores: StoreSummary[];
  loading: boolean;
  error?: Error;
};

export const useStores = (): UseStoresResult => {
  const client = useProcessorClient(undefined);
  const query = useQuery({
    queryKey: ['processor', 'stores'],
    queryFn: () => client.getStores(),
  });

  return {
    stores: query.data ?? [],
    loading: query.isPending,
    error: query.error ?? undefined,
  };
};
