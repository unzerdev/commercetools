/**
 * Store disconnect orchestration.
 *
 * `disconnectStoreConfig` clears the ACTIVE environment's credentials from the per-store Custom Object
 * override and, only when NO environment retains credentials afterward, deletes the whole object. The
 * post-rewrite version threads into the delete for optimistic-concurrency (CAS). A missing object is a
 * no-op (idempotent). It touches only the override — never the env `default` layer. After the CO is
 * settled it best-effort deletes the environment's registered Unzer webhooks (clear-then-delete: a
 * webhook-delete failure never leaves the CO half-updated), authenticating with the pre-clear
 * credentials it read.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { disconnectStoreConfig } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { PspError } from '../src/providers/psp';
import type { StoredStoreConfig } from '../src/domain';

describe('disconnectStoreConfig', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('clears the active env and keeps the rewritten CO when the other env still has credentials', async () => {
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: true, version: 7 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    expect(ports.configStore.clearEnvCredentials).toHaveBeenCalledWith('store-a', 'sandbox');
    expect(ports.configStore.delete).not.toHaveBeenCalled();
  });

  test('deletes the whole CO (CAS on the post-rewrite version) when neither env retains credentials', async () => {
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 9 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'live' }, { ports, provider });

    expect(ports.configStore.clearEnvCredentials).toHaveBeenCalledWith('store-a', 'live');
    expect(ports.configStore.delete).toHaveBeenCalledWith('store-a', 9);
  });

  test('is a no-op when no Custom Object exists (idempotent)', async () => {
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue(null);

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    expect(ports.configStore.delete).not.toHaveBeenCalled();
  });

  test('when no mode is supplied it falls back to the stored mode', async () => {
    const stored: StoredStoreConfig = {
      mode: 'live',
      environments: { live: { credentials: { apiKey: 'k' } } },
    };
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(stored);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 3 });

    await disconnectStoreConfig({ env, storeKey: 'store-a' }, { ports, provider });

    expect(ports.configStore.clearEnvCredentials).toHaveBeenCalledWith('store-a', 'live');
    expect(ports.configStore.delete).toHaveBeenCalledWith('store-a', 3);
  });

  // a disconnect removes EVERYTHING persisted for that store + environment, not just the
  // credentials. The per-method configuration describes the account being disconnected from, and a later
  // connect would read it straight back.
  describe('payment-method configuration', () => {
    const persistedMethods = (modes: ('sandbox' | 'live')[]) => ({
      store: 'store-a',
      environments: Object.fromEntries(
        modes.map((mode) => [mode, { paymentMethods: [{ paymentMethodCode: 'card' } as never] }]),
      ),
    });

    test('drops the disconnected environment’s block, keeping the other environment’s', async () => {
      ports.paymentMethodsStore.readWithVersion = jest
        .fn<typeof ports.paymentMethodsStore.readWithVersion>()
        .mockResolvedValue({ value: persistedMethods(['sandbox', 'live']), version: 4 });
      ports.configStore.clearEnvCredentials = jest
        .fn<typeof ports.configStore.clearEnvCredentials>()
        .mockResolvedValue({ remainingCredentials: true, version: 7 });

      await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

      const [, written, version] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
        string,
        { environments: Record<string, unknown> },
        number | undefined,
      ];
      expect(written.environments.sandbox).toBeUndefined();
      expect(written.environments.live).toBeDefined();
      expect(version).toBe(4);
      expect(ports.paymentMethodsStore.delete).not.toHaveBeenCalled();
    });

    test('deletes the payment-methods object once no environment is left configured (CAS)', async () => {
      ports.paymentMethodsStore.readWithVersion = jest
        .fn<typeof ports.paymentMethodsStore.readWithVersion>()
        .mockResolvedValue({ value: persistedMethods(['live']), version: 6 });
      ports.configStore.clearEnvCredentials = jest
        .fn<typeof ports.configStore.clearEnvCredentials>()
        .mockResolvedValue({ remainingCredentials: false, version: 9 });

      await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'live' }, { ports, provider });

      // The emptied object goes rather than being rewritten as a husk: a re-connect must start from the
      // account's own catalogue, not from a shell this connector kept.
      expect(ports.paymentMethodsStore.delete).toHaveBeenCalledWith('store-a', 6);
      expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
    });

    test('touches nothing when the store has no payment-methods object', async () => {
      await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

      expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
      expect(ports.paymentMethodsStore.delete).not.toHaveBeenCalled();
    });

    test('runs BEFORE the credential clear, and its failure leaves the store connected', async () => {
      ports.paymentMethodsStore.readWithVersion = jest
        .fn<typeof ports.paymentMethodsStore.readWithVersion>()
        .mockResolvedValue({ value: persistedMethods(['sandbox']), version: 4 });
      ports.paymentMethodsStore.delete = jest
        .fn<typeof ports.paymentMethodsStore.delete>()
        .mockRejectedValue(new Error('CT unavailable'));

      await expect(
        disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider }),
      ).rejects.toThrow('CT unavailable');

      // Nothing half-removed: the credentials are still there, so retrying the (idempotent) disconnect
      // is all the operator has to do.
      expect(ports.configStore.clearEnvCredentials).not.toHaveBeenCalled();
      expect(ports.configStore.delete).not.toHaveBeenCalled();
      expect(provider.webhook.deleteWebhooks).not.toHaveBeenCalled();
    });
  });

  test('deletes the disconnected env’s Unzer webhooks using the pre-clear stored credentials', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' } } },
    };
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(stored);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 4 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    expect(provider.webhook.deleteWebhooks).toHaveBeenCalledTimes(1);
    const [cfg] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [
      { mode: string; credentials: Record<string, string> },
    ];
    expect(cfg.mode).toBe('sandbox');
    expect(cfg.credentials).toMatchObject({ publicKey: 's-pub-key', privateKey: 's-priv-key' });
    // clear-then-delete: the webhooks are dropped only AFTER the CO is settled.
    const clearOrder = (ports.configStore.clearEnvCredentials as jest.Mock).mock.invocationCallOrder[0];
    const deleteOrder = (provider.webhook.deleteWebhooks as jest.Mock).mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(deleteOrder);
  });

  // the ids recorded at registration are what a disconnect targets, so an Unzer account shared
  // by two commercetools stores keeps the other store's subscriptions.
  test('deletes BY THE RECORDED IDS when the environment carries them', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        sandbox: {
          credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' },
          webhookIds: ['wh-1', 'wh-2'],
        },
      },
    };
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(stored);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 4 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    const [, ids] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [unknown, string[] | undefined];
    expect(ids).toEqual(['wh-1', 'wh-2']);
  });

  test('passes no ids for a connection saved before they were recorded (account-wide fallback)', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' } } },
    };
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(stored);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 4 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    const [, ids] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [unknown, string[] | undefined];
    expect(ids).toBeUndefined();
  });

  test('a webhook delete failure does not fail the disconnect (best-effort)', async () => {
    const stored: StoredStoreConfig = {
      mode: 'live',
      environments: { live: { credentials: { publicKey: 'p-pub-key', privateKey: 'p-priv-key' } } },
    };
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(stored);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 2 });
    provider.webhook.deleteWebhooks = jest
      .fn<typeof provider.webhook.deleteWebhooks>()
      .mockRejectedValue(new PspError('PSP request failed', 502));

    await expect(
      disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'live' }, { ports, provider }),
    ).resolves.toBeUndefined();
    // The CO was still cleared and deleted despite the webhook cleanup failing.
    expect(ports.configStore.delete).toHaveBeenCalledWith('store-a', 2);
  });

  test('skips webhook deletion when the disconnected env has no stored credentials', async () => {
    ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue(null);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: true, version: 1 });

    await disconnectStoreConfig({ env, storeKey: 'store-a', mode: 'sandbox' }, { ports, provider });

    expect(provider.webhook.deleteWebhooks).not.toHaveBeenCalled();
  });

  // Disconnect writes/deletes the per-store Custom Object, so it too must refuse the RESERVED project
  // key — no Custom Object may ever exist under it. A disconnect must NAME a real store: BOTH an
  // explicit `X-Store-Key == projectKey` and an absent header (which would fall back to it) are
  // rejected. `storeKey()` is the project key ('store-1') in the fake ports.
  test('rejects an X-Store-Key equal to the project key and never touches the Custom Object', async () => {
    await expect(
      disconnectStoreConfig({ env, storeKey: 'store-1', mode: 'sandbox' }, { ports, provider }),
    ).rejects.toThrow(/reserved/i);
    expect(ports.configStore.clearEnvCredentials).not.toHaveBeenCalled();
    expect(ports.configStore.delete).not.toHaveBeenCalled();
  });

  test('rejects an absent X-Store-Key (which would fall back to the reserved project key) and touches nothing', async () => {
    await expect(disconnectStoreConfig({ env, mode: 'sandbox' }, { ports, provider })).rejects.toThrow(
      /reserved|X-Store-Key/i,
    );
    expect(ports.configStore.clearEnvCredentials).not.toHaveBeenCalled();
    expect(ports.configStore.delete).not.toHaveBeenCalled();
  });
});
