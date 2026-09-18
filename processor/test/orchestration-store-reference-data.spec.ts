/**
 * The reference-data orchestration.
 *
 * `getStoreReferenceData` resolves the config app's picker data: `languages` from the Store; `countries`
 * from the Store when it scopes any, else the Project's full set; `currencies` always the Project's full
 * set. Both reference reads are driven through the `projectStoreReader` port.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getStoreReferenceData } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

describe('getStoreReferenceData', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('a store scoping its own countries is returned as-is, with the project currencies', async () => {
    ports.projectStoreReader.readStore = jest
      .fn<typeof ports.projectStoreReader.readStore>()
      .mockResolvedValue({ languages: ['en', 'nl'], countries: ['NL', 'BE'] });
    ports.projectStoreReader.readProjectSettings = jest
      .fn<typeof ports.projectStoreReader.readProjectSettings>()
      .mockResolvedValue({ languages: ['en', 'de', 'nl'], currencies: ['EUR', 'USD'], countries: ['NL', 'DE', 'US'] });

    const result = await getStoreReferenceData({ env, storeKey: 'store-a' }, { ports, provider });

    expect(result).toEqual({ languages: ['en', 'nl'], countries: ['NL', 'BE'], currencies: ['EUR', 'USD'] });
    expect(ports.projectStoreReader.readStore).toHaveBeenCalledWith('store-a');
  });

  test('a store with NO languages falls back to the full project language set', async () => {
    ports.projectStoreReader.readStore = jest
      .fn<typeof ports.projectStoreReader.readStore>()
      .mockResolvedValue({ languages: [], countries: ['NL'] });
    ports.projectStoreReader.readProjectSettings = jest
      .fn<typeof ports.projectStoreReader.readProjectSettings>()
      .mockResolvedValue({ languages: ['en', 'de', 'fr'], currencies: ['EUR'], countries: ['NL', 'DE'] });

    const result = await getStoreReferenceData({ env, storeKey: 'store-a' }, { ports, provider });

    expect(result.languages).toEqual(['en', 'de', 'fr']);
  });

  test('a store with NO countries falls back to the full project country set', async () => {
    ports.projectStoreReader.readStore = jest
      .fn<typeof ports.projectStoreReader.readStore>()
      .mockResolvedValue({ languages: ['en'], countries: [] });
    ports.projectStoreReader.readProjectSettings = jest
      .fn<typeof ports.projectStoreReader.readProjectSettings>()
      .mockResolvedValue({ languages: ['en', 'de'], currencies: ['EUR'], countries: ['NL', 'DE', 'FR'] });

    const result = await getStoreReferenceData({ env, storeKey: 'store-a' }, { ports, provider });

    expect(result).toEqual({ languages: ['en'], countries: ['NL', 'DE', 'FR'], currencies: ['EUR'] });
  });

  test('currencies always come from the project, never the store', async () => {
    ports.projectStoreReader.readStore = jest
      .fn<typeof ports.projectStoreReader.readStore>()
      .mockResolvedValue({ languages: ['en'], countries: ['NL'] });
    ports.projectStoreReader.readProjectSettings = jest
      .fn<typeof ports.projectStoreReader.readProjectSettings>()
      .mockResolvedValue({ languages: ['en'], currencies: ['EUR', 'GBP', 'USD'], countries: ['NL'] });

    const result = await getStoreReferenceData({ env, storeKey: 'store-a' }, { ports, provider });

    expect(result.currencies).toEqual(['EUR', 'GBP', 'USD']);
  });

  test('falls back to the deployment default store key when no X-Store-Key is forwarded', async () => {
    await getStoreReferenceData({ env }, { ports, provider });

    expect(ports.configResolver.storeKey).toHaveBeenCalledTimes(1);
    expect(ports.projectStoreReader.readStore).toHaveBeenCalledWith('store-1');
  });
});
