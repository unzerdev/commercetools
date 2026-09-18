/**
 * The store-list orchestration.
 *
 * `listStores` returns the DEFAULT SCOPE followed by every project store, each as a
 * `{ key, name }` summary for the config app's selector. It is NOT per-store, so it forwards no store key.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { listStores } from '../src/application/orchestration';
import { DEFAULT_SCOPE_STORE_KEY } from '../src/domain';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

describe('listStores', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('returns the reader store list verbatim, behind the default scope', async () => {
    const stores = [
      { key: 'store-a', name: 'Store A' },
      { key: 'store-b', name: 'Store B' },
    ];
    ports.projectStoreReader.listStores = jest
      .fn<typeof ports.projectStoreReader.listStores>()
      .mockResolvedValue(stores);

    const result = await listStores({ env }, { ports, provider });

    // The default scope is FIRST so the selector opens on it; the project stores follow untouched.
    expect(result[0]).toEqual({ key: DEFAULT_SCOPE_STORE_KEY, name: 'Default', isDefault: true });
    expect(result.slice(1)).toEqual(stores);
    expect(ports.projectStoreReader.listStores).toHaveBeenCalledTimes(1);
  });

  test('a project with no stores still offers the default scope', async () => {
    ports.projectStoreReader.listStores = jest.fn<typeof ports.projectStoreReader.listStores>().mockResolvedValue([]);

    await expect(listStores({ env }, { ports, provider })).resolves.toEqual([
      { key: DEFAULT_SCOPE_STORE_KEY, name: 'Default', isDefault: true },
    ]);
  });

  test('drops a project store whose key collides with the reserved default-scope key', async () => {
    // One key must never address two configurations: the default layer owns it.
    ports.projectStoreReader.listStores = jest.fn<typeof ports.projectStoreReader.listStores>().mockResolvedValue([
      { key: DEFAULT_SCOPE_STORE_KEY, name: 'Impostor' },
      { key: 'store-a', name: 'Store A' },
    ]);

    const result = await listStores({ env }, { ports, provider });

    expect(result).toEqual([
      { key: DEFAULT_SCOPE_STORE_KEY, name: 'Default', isDefault: true },
      { key: 'store-a', name: 'Store A' },
    ]);
  });
});
