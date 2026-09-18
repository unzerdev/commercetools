/**
 * `useStores` reads the connector-wide store list from the processor (the MC app makes ZERO
 * direct commercetools calls). `useProcessorClient` is mocked so no `/proxy/forward-to` fetch happens:
 * we assert the hook maps `getStores()` to its result, preserves the loading/error transitions the
 * config selector renders, and — the cache contract — loads ONCE per session: remounts and concurrent
 * mounts (StrictMode's dev double-mount) are served from the query cache, not the network.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useProcessorClient } from '../../src/processor';
import { useStores } from '../../src/hooks/use-stores';
import { createQueryHarness } from '../support/render-with-query-client';

jest.mock('../../src/processor', () => ({
  useProcessorClient: jest.fn(),
}));

const useProcessorClientMock = useProcessorClient as jest.MockedFunction<
  typeof useProcessorClient
>;

/** A processor client stub exposing only the `getStores` method the hook consumes. */
const clientWith = (getStores: jest.Mock) =>
  ({ getStores }) as unknown as ReturnType<typeof useProcessorClient>;

describe('useStores', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the client without a selected store — the list is connector-wide', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockResolvedValue([]))
    );

    const { result } = renderHook(() => useStores(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(useProcessorClientMock).toHaveBeenCalledWith(undefined);
  });

  it('starts loading, then returns the processor stores', async () => {
    const { Wrapper } = createQueryHarness();
    const stores = [
      { key: 'eu-store', name: 'EU Store' },
      { key: 'us-store', name: 'US Store' },
    ];
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockResolvedValue(stores))
    );

    const { result } = renderHook(() => useStores(), { wrapper: Wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.stores).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stores).toEqual(stores);
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces a processor error and leaves the list empty', async () => {
    const { Wrapper } = createQueryHarness();
    useProcessorClientMock.mockReturnValue(
      clientWith(jest.fn().mockRejectedValue(new Error('Gateway error')))
    );

    const { result } = renderHook(() => useStores(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stores).toEqual([]);
    expect(result.current.error?.message).toBe('Gateway error');
  });

  it('loads once — a remount on the same cache is served from memory', async () => {
    const { Wrapper } = createQueryHarness();
    const getStores = jest
      .fn()
      .mockResolvedValue([{ key: 'eu-store', name: 'EU Store' }]);
    useProcessorClientMock.mockReturnValue(clientWith(getStores));

    const first = renderHook(() => useStores(), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useStores(), { wrapper: Wrapper });
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(second.result.current.stores).toEqual([
      { key: 'eu-store', name: 'EU Store' },
    ]);
    expect(getStores).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent mounts (StrictMode shape) into ONE request', async () => {
    const { Wrapper } = createQueryHarness();
    const getStores = jest.fn().mockResolvedValue([]);
    useProcessorClientMock.mockReturnValue(clientWith(getStores));

    const { result } = renderHook(() => [useStores(), useStores()] as const, {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current[0].loading).toBe(false);
      expect(result.current[1].loading).toBe(false);
    });

    expect(getStores).toHaveBeenCalledTimes(1);
  });
});
