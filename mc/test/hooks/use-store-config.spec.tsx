/**
 * `useStoreConfig` reads the selected store's connector config from the processor into the query
 * cache. Contract under test: store-scoped load with the `loading | error | loaded` transitions
 * `StoreConfig` renders; loads ONCE per store (remounts served from memory); and a cache write on
 * `storeConfigQueryKey` (how `persist()` publishes the PUT response) is visible to the hook without
 * any network call — the mechanism that keeps "read from memory" from ever meaning "stale config".
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useProcessorClient } from '../../src/processor';
import {
  storeConfigQueryKey,
  useStoreConfig,
} from '../../src/hooks/use-store-config';
import type { StoreConfigDto } from '../../src/types/config';
import { createQueryHarness } from '../support/render-with-query-client';

jest.mock('../../src/processor', () => ({
  useProcessorClient: jest.fn(),
}));

const useProcessorClientMock = useProcessorClient as jest.MockedFunction<
  typeof useProcessorClient
>;

/** A processor client stub exposing only the `getStoreConfig` method the hook consumes. */
const clientWith = (getStoreConfig: jest.Mock) =>
  ({ getStoreConfig }) as unknown as ReturnType<typeof useProcessorClient>;

const CONFIG = { mode: 'sandbox' } as StoreConfigDto;

describe('useStoreConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the client scoped to the selected store key and maps the config', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockResolvedValue(CONFIG))
    );

    const { result } = renderHook(() => useStoreConfig('eu-store'), {
      wrapper: Wrapper,
    });
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(useProcessorClientMock).toHaveBeenCalledWith('eu-store');
    expect(result.current.config).toEqual(CONFIG);
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces a processor error without a config', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockRejectedValue(new Error('Forbidden')))
    );

    const { result } = renderHook(() => useStoreConfig('eu-store'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toBeUndefined();
    expect(result.current.error?.message).toBe('Forbidden');
  });

  it('loads once — a remount on the same cache is served from memory', async () => {
    const { Wrapper } = createQueryHarness();
    const getStoreConfig = jest.fn().mockResolvedValue(CONFIG);
    useProcessorClientMock.mockReturnValue(clientWith(getStoreConfig));

    const first = renderHook(() => useStoreConfig('eu-store'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useStoreConfig('eu-store'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(second.result.current.config).toEqual(CONFIG);
    expect(getStoreConfig).toHaveBeenCalledTimes(1);
  });

  it('serves a cache write (the PUT response) without any network call', async () => {
    const { Wrapper, queryClient } = createQueryHarness();
    const getStoreConfig = jest.fn().mockResolvedValue(CONFIG);
    useProcessorClientMock.mockReturnValue(clientWith(getStoreConfig));

    const saved = { mode: 'live' } as StoreConfigDto;
    queryClient.setQueryData(storeConfigQueryKey('eu-store'), saved);

    const { result } = renderHook(() => useStoreConfig('eu-store'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.config).toEqual(saved);
    expect(getStoreConfig).not.toHaveBeenCalled();
  });
});
