import { createContext, useContext } from 'react';
import type { UseReferenceDataResult } from './use-reference-data';

/**
 * Shares ONE store-scoped reference-data fetch (see {@link useReferenceData}) with the config pickers that
 * consume it — the add-profile country/currency selectors and the pay-button locale switch — without
 * drilling it through the intervening selector/section components. Provided once in the store-config
 * subtree, where the selected store key is available.
 */
const ReferenceDataContext = createContext<UseReferenceDataResult | undefined>(
  undefined
);

export const ReferenceDataProvider = ReferenceDataContext.Provider;

export const useReferenceDataContext = (): UseReferenceDataResult => {
  const value = useContext(ReferenceDataContext);
  if (value === undefined) {
    throw new Error(
      'useReferenceDataContext must be used within a ReferenceDataProvider.'
    );
  }
  return value;
};
