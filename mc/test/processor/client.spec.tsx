/**
 * `useProcessorClient` forward-to wiring: every processor call must set `includeUserPermissions` on the
 * forward-to config so the MC API Gateway mints an exchange token carrying the operator's permissions
 * under the `<iss>/claims/user_permissions` claim (`X-Forward-To-Claims: permissions`). The processor's
 * manage-permission gate depends on it.
 *
 * The application-shell HTTP client is mocked so no `/proxy/forward-to` fetch happens: we assert the
 * SECOND argument of `executeHttpClientRequest` (the config) directly.
 */

import { renderHook } from '@testing-library/react';
import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { useProcessorClient } from '../../src/processor';

jest.mock('@commercetools-frontend/application-shell', () => ({
  buildApiUrl: jest.fn((endpoint: string) => `https://mc-api.test${endpoint}`),
  executeHttpClientRequest: jest.fn(),
}));
jest.mock('@commercetools-frontend/application-shell-connectors', () => ({
  useApplicationContext: jest.fn(),
}));

const executeMock = executeHttpClientRequest as jest.MockedFunction<
  typeof executeHttpClientRequest
>;
const useApplicationContextMock = useApplicationContext as jest.MockedFunction<
  typeof useApplicationContext
>;

const PROCESSOR = 'https://processor.example.test';

/** The forward-to config passed to the most recent `executeHttpClientRequest` call. */
const lastForwardToConfig = () => {
  const call = executeMock.mock.calls[executeMock.mock.calls.length - 1];
  return call[1]?.forwardToConfig;
};

describe('useProcessorClient — forward-to permissions claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildApiUrl as jest.Mock).mockImplementation(
      (endpoint: string) => `https://mc-api.test${endpoint}`
    );
    useApplicationContextMock.mockImplementation((selector) =>
      selector({ environment: { processorUrl: PROCESSOR } } as never)
    );
    // The client parses the fetcher's response; resolve a benign shape for every method.
    executeMock.mockResolvedValue({} as never);
  });

  const renderClient = (storeKey: string | undefined = 'eu-store') =>
    renderHook(() => useProcessorClient(storeKey)).result.current;

  it('sets includeUserPermissions on getStoreConfig', async () => {
    await renderClient().getStoreConfig();
    expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    expect(lastForwardToConfig()?.uri).toBe(
      `${PROCESSOR}/operations/store-config`
    );
  });

  it('sets includeUserPermissions on putStoreConfig', async () => {
    await renderClient().putStoreConfig({ mode: 'sandbox' });
    expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
  });

  it('sets includeUserPermissions on getPaymentMethods', async () => {
    await renderClient().getPaymentMethods();
    expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    expect(lastForwardToConfig()?.uri).toBe(
      `${PROCESSOR}/operations/payment-methods`
    );
  });

  it('scopes getPaymentMethods to the requested environment via ?mode=', async () => {
    await renderClient().getPaymentMethods('live');
    expect(lastForwardToConfig()?.uri).toBe(
      `${PROCESSOR}/operations/payment-methods?mode=live`
    );
  });

  it('sets includeUserPermissions on putPaymentMethods', async () => {
    await renderClient().putPaymentMethods({ paymentMethods: [] });
    expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    expect(lastForwardToConfig()?.uri).toBe(
      `${PROCESSOR}/operations/payment-methods`
    );
  });

  it('scopes putPaymentMethods to the requested environment via ?mode=', async () => {
    await renderClient().putPaymentMethods({ paymentMethods: [] }, 'live');
    expect(lastForwardToConfig()?.uri).toBe(
      `${PROCESSOR}/operations/payment-methods?mode=live`
    );
  });

  it('still forwards the selected store key alongside the permissions claim', async () => {
    await renderClient('eu-store').getStoreConfig();
    expect(lastForwardToConfig()?.headers).toEqual({
      'x-store-key': 'eu-store',
    });
    expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
  });
});

/**
 * Connection-lifecycle methods (disconnect, reference data, store list). Here the mock actually invokes
 * the fetcher against a stubbed `global.fetch`, so the real HTTP method, `/proxy/forward-to` target,
 * body parsing, and error-propagation path are exercised — not just the forward-to config.
 */
describe('useProcessorClient — connection lifecycle methods', () => {
  const FETCHER_OPTIONS = {
    credentials: 'include' as RequestCredentials,
    headers: { authorization: 'Bearer exchange-token' },
  };

  /** Stub `global.fetch` with a Response-like body and drive the fetcher through `executeMock`. */
  const stubFetch = (body: unknown, ok = true, status = 200) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: async () => text,
      headers: { get: () => null },
    }) as never;
    executeMock.mockImplementation(
      async (fetcher: Parameters<typeof executeHttpClientRequest>[0]) =>
        (await fetcher(FETCHER_OPTIONS as never)).data
    );
  };

  /** The `[url, init]` of the most recent `fetch` call. */
  const lastFetchCall = () => {
    const fetchMock = global.fetch as jest.Mock;
    return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (buildApiUrl as jest.Mock).mockImplementation(
      (endpoint: string) => `https://mc-api.test${endpoint}`
    );
    useApplicationContextMock.mockImplementation((selector) =>
      selector({ environment: { processorUrl: PROCESSOR } } as never)
    );
  });

  const renderClient = (storeKey: string | undefined = 'eu-store') =>
    renderHook(() => useProcessorClient(storeKey)).result.current;

  describe('deleteConnection', () => {
    it('issues a DELETE to store-config with the active mode and forwards the store key', async () => {
      stubFetch(undefined);
      await renderClient('eu-store').deleteConnection('live');

      const [url, init] = lastFetchCall();
      expect(url).toBe('https://mc-api.test/proxy/forward-to');
      expect(init.method).toBe('DELETE');
      expect(lastForwardToConfig()?.uri).toBe(
        `${PROCESSOR}/operations/store-config?mode=live`
      );
      expect(lastForwardToConfig()?.headers).toEqual({
        'x-store-key': 'eu-store',
      });
      expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    });

    it('resolves without a body on a 200 empty response', async () => {
      stubFetch(undefined);
      await expect(
        renderClient().deleteConnection('sandbox')
      ).resolves.toBeUndefined();
    });

    it('propagates a processor error message', async () => {
      stubFetch({ message: 'Store not found' }, false, 404);
      await expect(renderClient().deleteConnection('sandbox')).rejects.toThrow(
        'Store not found'
      );
    });
  });

  describe('getStoreReferenceData', () => {
    it('GETs store-reference-data, forwards the store key, and parses the typed shape', async () => {
      const reference = {
        languages: ['en', 'de'],
        currencies: ['EUR'],
        countries: ['NL', 'DE'],
      };
      stubFetch(reference);

      const result = await renderClient('eu-store').getStoreReferenceData();

      expect(result).toEqual(reference);
      const [, init] = lastFetchCall();
      expect(init.method).toBe('GET');
      expect(lastForwardToConfig()?.uri).toBe(
        `${PROCESSOR}/operations/store-reference-data`
      );
      expect(lastForwardToConfig()?.headers).toEqual({
        'x-store-key': 'eu-store',
      });
      expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    });

    it('propagates a processor error message', async () => {
      stubFetch({ message: 'Forbidden' }, false, 403);
      await expect(renderClient().getStoreReferenceData()).rejects.toThrow(
        'Forbidden'
      );
    });
  });

  describe('getStores', () => {
    it('GETs stores WITHOUT the store key but with the permissions claim, and parses the list', async () => {
      const stores = [
        { key: 'eu-store', name: 'EU Store' },
        { key: 'us-store', name: 'US Store' },
      ];
      stubFetch(stores);

      const result = await renderClient('eu-store').getStores();

      expect(result).toEqual(stores);
      const [, init] = lastFetchCall();
      expect(init.method).toBe('GET');
      expect(lastForwardToConfig()?.uri).toBe(`${PROCESSOR}/operations/stores`);
      expect(lastForwardToConfig()?.headers).toEqual({});
      expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    });

    it('propagates a processor error message', async () => {
      stubFetch({ message: 'Gateway error' }, false, 502);
      await expect(renderClient().getStores()).rejects.toThrow('Gateway error');
    });
  });
});
