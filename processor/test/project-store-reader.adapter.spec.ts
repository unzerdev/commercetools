/**
 * `ProjectStoreReaderAdapter` maps the commercetools Store + Project resources down to plain
 * ISO-code arrays. It drives the REAL adapter with a mocked apiRoot builder chain
 * (`paymentSDK.ctAPI.client.stores().withKey().get().execute()` and `client.get().execute()`),
 * asserting the field lift — notably that Store `countries` `{ code }` objects become bare codes.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { ProjectStoreReaderAdapter } from '../src/infrastructure/adapters/project-store-reader.adapter';

describe('core/adapters — ProjectStoreReaderAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('readStore lifts the Store languages and maps its countries to bare ISO codes', async () => {
    const storeExecute = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ body: { languages: ['en', 'nl'], countries: [{ code: 'NL' }, { code: 'BE' }] } });
    const withKey = jest.fn((args: { key: string }) => {
      capturedKey = args.key;
      return { get: () => ({ execute: storeExecute }) };
    });
    let capturedKey: string | undefined;
    jest.spyOn(paymentSDK.ctAPI.client, 'stores').mockReturnValue({ withKey } as never);

    const adapter = new ProjectStoreReaderAdapter();
    const result = await adapter.readStore('store-a');

    expect(capturedKey).toBe('store-a');
    expect(result).toEqual({ languages: ['en', 'nl'], countries: ['NL', 'BE'] });
  });

  it('readStore returns empty countries when the Store scopes none', async () => {
    const storeExecute = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ body: { languages: ['en'], countries: [] } });
    jest
      .spyOn(paymentSDK.ctAPI.client, 'stores')
      .mockReturnValue({ withKey: () => ({ get: () => ({ execute: storeExecute }) }) } as never);

    const adapter = new ProjectStoreReaderAdapter();

    await expect(adapter.readStore('store-a')).resolves.toEqual({ languages: ['en'], countries: [] });
  });

  it('readProjectSettings lifts languages, currencies and countries from the project root', async () => {
    const projectExecute = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ body: { languages: ['en', 'de'], currencies: ['EUR', 'USD'], countries: ['NL', 'DE'] } });
    jest.spyOn(paymentSDK.ctAPI.client, 'get').mockReturnValue({ execute: projectExecute } as never);

    const adapter = new ProjectStoreReaderAdapter();
    const result = await adapter.readProjectSettings();

    expect(result).toEqual({ languages: ['en', 'de'], currencies: ['EUR', 'USD'], countries: ['NL', 'DE'] });
  });

  it('listStores maps each Store to { key, name }, collapsing the localized name to its first value', async () => {
    const listExecute = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      body: {
        results: [
          { key: 'store-a', name: { en: 'Store A', nl: 'Winkel A' } },
          { key: 'store-b', name: { de: 'Laden B' } },
        ],
      },
    });
    jest.spyOn(paymentSDK.ctAPI.client, 'stores').mockReturnValue({ get: () => ({ execute: listExecute }) } as never);

    const adapter = new ProjectStoreReaderAdapter();
    const result = await adapter.listStores();

    expect(result).toEqual([
      { key: 'store-a', name: 'Store A' },
      { key: 'store-b', name: 'Laden B' },
    ]);
  });

  it('listStores falls back to the key when a Store has no name (or only empty values)', async () => {
    const listExecute = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      body: {
        results: [{ key: 'store-a' }, { key: 'store-b', name: { en: '' } }],
      },
    });
    jest.spyOn(paymentSDK.ctAPI.client, 'stores').mockReturnValue({ get: () => ({ execute: listExecute }) } as never);

    const adapter = new ProjectStoreReaderAdapter();

    await expect(adapter.listStores()).resolves.toEqual([
      { key: 'store-a', name: 'store-a' },
      { key: 'store-b', name: 'store-b' },
    ]);
  });
});
