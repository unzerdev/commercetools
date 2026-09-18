/**
 * `useReferenceData` reads a store's commercetools reference data (languages/currencies/countries) from
 * the processor (the MC app makes ZERO direct commercetools calls). `useProcessorClient` is
 * mocked so no `/proxy/forward-to` fetch happens: we assert the hook maps `getStoreReferenceData()` to its
 * result, preserves the loading/error transitions the pickers render, is store-scoped — and, the cache
 * contract, fetches ONCE per store: switching back to an already-loaded store is served from memory.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useProcessorClient } from '../../src/processor';
import { useReferenceData } from '../../src/hooks/use-reference-data';
import { createQueryHarness } from '../support/render-with-query-client';

jest.mock('../../src/processor', () => ({
  useProcessorClient: jest.fn(),
}));

const useProcessorClientMock = useProcessorClient as jest.MockedFunction<
  typeof useProcessorClient
>;

/** A processor client stub exposing only the `getStoreReferenceData` method the hook consumes. */
const clientWith = (getStoreReferenceData: jest.Mock) =>
  ({ getStoreReferenceData }) as unknown as ReturnType<
    typeof useProcessorClient
  >;

const REFERENCE = {
  languages: ['en', 'de'],
  currencies: ['EUR', 'USD'],
  countries: ['NL', 'DE'],
};

describe('useReferenceData', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the client scoped to the selected store key', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockResolvedValue(REFERENCE))
    );

    const { result } = renderHook(() => useReferenceData('eu-store'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(useProcessorClientMock).toHaveBeenCalledWith('eu-store');
  });

  it('starts loading, then maps getStoreReferenceData to languages/currencies/countries', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockResolvedValue(REFERENCE))
    );

    const { result } = renderHook(() => useReferenceData('eu-store'), {
      wrapper: Wrapper,
    });
    expect(result.current.loading).toBe(true);
    expect(result.current).toMatchObject({
      languages: [],
      currencies: [],
      countries: [],
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languages).toEqual(['en', 'de']);
    expect(result.current.currencies).toEqual(['EUR', 'USD']);
    expect(result.current.countries).toEqual(['NL', 'DE']);
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces a processor error and leaves the lists empty', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockRejectedValue(new Error('Forbidden')))
    );

    const { result } = renderHook(() => useReferenceData('eu-store'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languages).toEqual([]);
    expect(result.current.currencies).toEqual([]);
    expect(result.current.countries).toEqual([]);
    expect(result.current.error?.message).toBe('Forbidden');
  });

  it('fetches once per store — switching a→b→a serves the third mount from memory', async () => {
    const { Wrapper } = createQueryHarness();
    const getStoreReferenceData = jest.fn().mockResolvedValue(REFERENCE);
    useProcessorClientMock.mockReturnValue(clientWith(getStoreReferenceData));

    const { result, rerender } = renderHook(
      ({ storeKey }: { storeKey: string }) => useReferenceData(storeKey),
      { initialProps: { storeKey: 'store-a' }, wrapper: Wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ storeKey: 'store-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ storeKey: 'store-a' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languages).toEqual(['en', 'de']);

    expect(getStoreReferenceData).toHaveBeenCalledTimes(2);
  });
});
