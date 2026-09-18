import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { getBrand } from '../src/infrastructure/config/brand';
import { decrypt, encrypt, isEncrypted } from '../src/infrastructure/crypto/crypto';
import {
  clearEnvCredentials,
  deleteStoreConfigObject,
  readStoreConfigObject,
  readStoreConfigWithVersion,
  writeStoreConfigObject,
} from '../src/infrastructure/persistence/store-config.repository';
import type { StoredStoreConfig } from '../src/domain';

// A 64-hex-char key is used verbatim as the 32 raw key bytes (see config/crypto).
const HEX_64_KEY = 'a'.repeat(64);

/** A fully-populated persisted config object: secret leaves + non-secret pass-through fields. */
const sampleConfig = (): StoredStoreConfig => ({
  mode: 'sandbox',
  environments: {
    sandbox: {
      credentials: { publicKey: 'test-key', privateKey: 'test-secret' },
      host: 'https://test.example',
      webhookSecret: 'test-webhook-secret',
      webhookUrl: 'https://hook.example/test',
    },
    live: {
      credentials: { publicKey: 'live-key', privateKey: 'live-secret' },
      host: 'https://live.example',
      webhookSecret: 'live-webhook-secret',
    },
  },
  settings: {
    flows: {
      embedded: {
        enabled: true,
        buttonTitles: { en: 'Pay' },
        threeDs: { enablement: true, challenge: false, exemption: true },
      },
      'hpp-preselected': {
        enabled: false,
        sendOrderData: true,
        threeDs: { enablement: true, challenge: false, exemption: false },
      },
      hpp: {
        enabled: false,
        buttonTitles: {},
        groupMethods: false,
        sendOrderData: true,
        threeDs: { enablement: true, challenge: false, exemption: false },
      },
    },
    general: {
      merchantReference: 'ORDER1',
      transactionType: 'SALE',
      authorizationMode: 'PRE_AUTHORIZATION',
      captureAuthorizationMode: 'endOfDay',
      timeoutMinutes: 60,
      showResultPage: true,
      enableLogs: false,
      defaultLanguage: 'en',
    },
  },
});

/**
 * Mock the raw commercetools apiRoot custom-object builder chain used by the repository:
 *   client.customObjects().withContainerAndKey({container,key}).get().execute()
 *   client.customObjects().withContainerAndKey({container,key}).delete({queryArgs}).execute()
 *   client.customObjects().post({ body }).execute()
 * capturing the container/key, POST body and DELETE query args while letting each test drive `execute`.
 */
interface Captured {
  containerKey?: { container: string; key: string };
  postBody?: { container: string; key: string; value: StoredStoreConfig; version?: number };
  deleteArgs?: { queryArgs?: { version?: number } };
  getExecute: jest.Mock<() => Promise<unknown>>;
  postExecute: jest.Mock<() => Promise<unknown>>;
  deleteExecute: jest.Mock<() => Promise<unknown>>;
}

function mockCustomObjects(): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>(),
    deleteExecute: jest.fn<() => Promise<unknown>>(),
  };
  const builder = {
    withContainerAndKey: (args: { container: string; key: string }) => {
      captured.containerKey = args;
      return {
        get: () => ({ execute: captured.getExecute }),
        delete: (methodArgs?: { queryArgs?: { version?: number } }) => {
          captured.deleteArgs = methodArgs;
          return { execute: captured.deleteExecute };
        },
      };
    },
    post: (args: { body: Captured['postBody'] }) => {
      captured.postBody = args.body;
      return { execute: captured.postExecute };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'customObjects').mockReturnValue(builder as never);
  return captured;
}

describe('config/store-config.repository', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = HEX_64_KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('writeStoreConfigObject', () => {
    it('targets the brand custom-object container and the storeKey', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await writeStoreConfigObject('store-a', sampleConfig());

      expect(captured.postBody?.container).toBe(getBrand().customObjectContainer);
      expect(captured.postBody?.key).toBe('store-a');
    });

    it('encrypts every credentials value and webhookSecret in each environment', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await writeStoreConfigObject('store-a', sampleConfig());

      const persisted = captured.postBody!.value;
      const sandboxEnv = persisted.environments!.sandbox!;
      const liveEnv = persisted.environments!.live!;

      expect(isEncrypted(sandboxEnv.credentials!.publicKey)).toBe(true);
      // privateKey is a credentials-bag leaf, so it is encrypted at rest like any other credential.
      expect(isEncrypted(sandboxEnv.credentials!.privateKey)).toBe(true);
      expect(decrypt(sandboxEnv.credentials!.privateKey)).toBe('test-secret');
      expect(isEncrypted(sandboxEnv.webhookSecret!)).toBe(true);
      expect(isEncrypted(liveEnv.credentials!.publicKey)).toBe(true);
      expect(isEncrypted(liveEnv.webhookSecret!)).toBe(true);

      // Ciphertext, not the plaintext.
      expect(sandboxEnv.credentials!.publicKey).not.toBe('test-key');
      // Round-trips back to the original plaintext.
      expect(decrypt(sandboxEnv.credentials!.publicKey)).toBe('test-key');
      expect(decrypt(sandboxEnv.webhookSecret!)).toBe('test-webhook-secret');
    });

    it('leaves non-secret fields untouched', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      const input = sampleConfig();
      await writeStoreConfigObject('store-a', input);

      const persisted = captured.postBody!.value;
      expect(persisted.mode).toBe('sandbox');
      expect(persisted.environments!.sandbox!.host).toBe('https://test.example');
      expect(persisted.environments!.sandbox!.webhookUrl).toBe('https://hook.example/test');
      expect(persisted.settings).toEqual(input.settings);
    });

    it('does not double-encrypt an already-encrypted secret', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      const preEncrypted = encrypt('already-secret');
      const input = sampleConfig();
      input.environments!.sandbox!.credentials!.publicKey = preEncrypted;

      await writeStoreConfigObject('store-a', input);

      const persisted = captured.postBody!.value;
      // Untouched (same ciphertext) → a single decrypt still yields the plaintext.
      expect(persisted.environments!.sandbox!.credentials!.publicKey).toBe(preEncrypted);
      expect(decrypt(persisted.environments!.sandbox!.credentials!.publicKey)).toBe('already-secret');
    });

    it('passes the version through for optimistic concurrency (CAS) on update', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 8, value: {} } });

      await writeStoreConfigObject('store-a', sampleConfig(), 7);

      expect(captured.postBody?.version).toBe(7);
    });

    it('omits version on a first create (no CAS argument)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await writeStoreConfigObject('store-a', sampleConfig());

      expect(captured.postBody).not.toHaveProperty('version');
    });

    it('answers with the DECRYPTED document while persisting ciphertext', async () => {
      const captured = mockCustomObjects();
      // commercetools echoes the encrypted document it was sent; the echo must never be the return value,
      // or the merchant PUT response carries `v1:<key-id>:…` instead of the key pair.
      captured.postExecute.mockImplementation(async () => ({
        body: { version: 2, value: captured.postBody!.value },
      }));

      const input = sampleConfig();
      const returned = await writeStoreConfigObject('store-a', input);

      expect(returned).toEqual(input);
      expect(returned.environments!.sandbox!.credentials!.privateKey).toBe('test-secret');
      expect(isEncrypted(captured.postBody!.value.environments!.sandbox!.credentials!.privateKey)).toBe(true);
    });
  });

  describe('readStoreConfigObject', () => {
    it('round-trips: what write persisted decrypts back to the original secrets', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      const original = sampleConfig();
      await writeStoreConfigObject('store-a', original);
      const persisted = captured.postBody!.value; // encrypted at rest

      // The subsequent GET returns exactly what was stored.
      captured.getExecute.mockResolvedValue({ body: { version: 1, value: persisted } });

      const read = await readStoreConfigObject('store-a');

      expect(read).toEqual(original);
      expect(captured.containerKey).toEqual({
        container: getBrand().customObjectContainer,
        key: 'store-a',
      });
    });

    it('returns null when the custom object does not exist', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(readStoreConfigObject('missing')).resolves.toBeNull();
    });

    it('re-throws non-404 errors', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(readStoreConfigObject('store-a')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('readStoreConfigWithVersion', () => {
    it('returns the decrypted value AND the version in a single GET', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      const original = sampleConfig();
      await writeStoreConfigObject('store-a', original);
      const persisted = captured.postBody!.value; // encrypted at rest
      captured.getExecute.mockResolvedValue({ body: { version: 6, value: persisted } });

      const result = await readStoreConfigWithVersion('store-a');

      expect(result).toEqual({ value: original, version: 6 });
      expect(captured.getExecute).toHaveBeenCalledTimes(1);
    });

    it('returns { value: null, version: undefined } when the object does not exist', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(readStoreConfigWithVersion('missing')).resolves.toEqual({ value: null, version: undefined });
    });

    it('re-throws non-404 errors', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(readStoreConfigWithVersion('store-a')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('deleteStoreConfigObject', () => {
    it('deletes the brand container / storeKey object, threading the version for CAS', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockResolvedValue({ body: { version: 3, value: {} } });

      await deleteStoreConfigObject('store-a', 3);

      expect(captured.containerKey).toEqual({
        container: getBrand().customObjectContainer,
        key: 'store-a',
      });
      expect(captured.deleteArgs).toEqual({ queryArgs: { version: 3 } });
    });

    it('omits the version query arg when none is supplied', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockResolvedValue({ body: { version: 3, value: {} } });

      await deleteStoreConfigObject('store-a');

      expect(captured.deleteArgs).toEqual({});
    });

    it('tolerates a 404 (object already gone) so delete is idempotent', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(deleteStoreConfigObject('missing', 1)).resolves.toBeUndefined();
    });

    it('re-throws non-404 delete errors', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(deleteStoreConfigObject('store-a', 1)).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('clearEnvCredentials', () => {
    /** Echo the posted (encrypted-at-rest) value back with a bumped version, like commercetools would. */
    const echoPostAt = (captured: Captured, version: number): void => {
      captured.postExecute.mockImplementation(async () => ({
        body: { version, value: captured.postBody!.value },
      }));
    };

    it('removes the target env credentials, webhookSecret and webhook ids, keeping its non-secret fields', async () => {
      const captured = mockCustomObjects();
      const withIds = sampleConfig();
      withIds.environments!.sandbox!.webhookIds = ['wh-1', 'wh-2'];
      captured.getExecute.mockResolvedValue({ body: { version: 4, value: withIds } });
      echoPostAt(captured, 5);

      const result = await clearEnvCredentials('store-a', 'sandbox');

      const written = captured.postBody!.value;
      const sandboxEnv = written.environments!.sandbox!;
      expect(sandboxEnv.credentials).toBeUndefined();
      expect(sandboxEnv.webhookSecret).toBeUndefined();
      // The ids go with the credentials that created them: kept, they would aim the next delete at
      // subscriptions on an account this store no longer uses.
      expect(sandboxEnv.webhookIds).toBeUndefined();
      expect(sandboxEnv.host).toBe('https://test.example');
      expect(sandboxEnv.webhookUrl).toBe('https://hook.example/test');
      // The other environment is untouched — its credentials survive.
      expect(Object.keys(written.environments!.live!.credentials!).length).toBeGreaterThan(0);
      // CAS: the rewrite reuses the version read moments earlier.
      expect(captured.postBody!.version).toBe(4);
      expect(result).toEqual({ remainingCredentials: true, version: 5 });
    });

    it('skips the rewrite and returns the READ version when clearing the last env (delete-only disconnect)', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockResolvedValue({
        body: {
          version: 2,
          value: {
            mode: 'sandbox',
            environments: { sandbox: { credentials: { publicKey: 'k' }, webhookSecret: 's' } },
          } as StoredStoreConfig,
        },
      });

      const result = await clearEnvCredentials('store-a', 'sandbox');

      // No environment retains credentials, so no intermediate rewrite is issued — the caller deletes the
      // object at the read version (one CT write, not a rewrite-then-delete).
      expect(captured.postExecute).not.toHaveBeenCalled();
      expect(result).toEqual({ remainingCredentials: false, version: 2 });
    });

    it('returns null and writes nothing when no Custom Object exists', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(clearEnvCredentials('missing', 'sandbox')).resolves.toBeNull();
      expect(captured.postExecute).not.toHaveBeenCalled();
    });

    it('re-throws a non-404 read error', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(clearEnvCredentials('store-a', 'sandbox')).rejects.toMatchObject({ statusCode: 500 });
    });
  });
});
