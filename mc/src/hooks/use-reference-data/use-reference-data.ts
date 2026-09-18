import { useQuery } from '@tanstack/react-query';
import { useProcessorClient } from '../../processor';
import type { StoreReferenceData } from '../../types/config';

/**
 * Reads a store's commercetools reference data (languages/currencies/countries) from the processor so the
 * config pickers source their ISO lists from commercetools rather than hardcoding them.
 * Store-scoped: the client rides the selected store key, so this must run where a store key is available
 * (inside the store-config subtree), never at the store-selector level. Mirrors `useStores`' loading/error
 * transitions so a picker can gate on them.
 *
 * Cached per store under a session-lifetime query (`entry-point.tsx` defaults): each store's reference
 * data loads ONCE — switching back to an already-loaded store is served from memory.
 */

export type UseReferenceDataResult = StoreReferenceData & {
  loading: boolean;
  error?: Error;
};

const EMPTY: StoreReferenceData = {
  languages: [],
  currencies: [],
  countries: [],
};

export const useReferenceData = (
  storeKey: string | undefined
): UseReferenceDataResult => {
  const client = useProcessorClient(storeKey);
  const query = useQuery({
    queryKey: ['processor', 'store-reference-data', storeKey],
    queryFn: () => client.getStoreReferenceData(),
  });

  return {
    ...(query.data ?? EMPTY),
    loading: query.isPending,
    error: query.error ?? undefined,
  };
};
