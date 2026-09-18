/**
 * mandatory key-pair gate on `PUT /operations/store-config`.
 *
 * An environment whose credentials are actually being connected/CHANGED must carry BOTH the Unzer
 * `publicKey` and `privateKey` (fail-closed, no grace period): such a save missing either is rejected with
 * a field-level 400 and nothing is persisted. Enforcement is tied to the SAME per-env "credentials changed
 * vs stored" signal the probe uses — because `formToConfig` always submits both `sandbox` and `live`
 * blocks, an untouched legacy env (masked, unchanged, incomplete key pair) must NOT block saving the env the
 * operator is editing. The REAL `PspConfigHandler` supplies the required-field topology and the masking
 * reconcile; the provider probe stays a fake success, since the probe path has its own suite.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { updateStoreConfig } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { PspConfigHandler } from '../src/providers/psp/config/config.handler';
import type { StoredStoreConfig } from '../src/domain';

/** The full active-environment credentials bag MC always submits (the Unzer public/private key pair). */
const creds = (overrides: Record<string, string> = {}) => ({
  publicKey: 's-pub-key',
  privateKey: 's-priv-key',
  ...overrides,
});

/** A connect body for the `sandbox` environment. */
const connectBody = (credentials: Record<string, string>): StoredStoreConfig => ({
  mode: 'sandbox',
  environments: { sandbox: { credentials } },
});

describe('updateStoreConfig — mandatory key-pair gate', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();
  const real = new PspConfigHandler();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    // The gate reads the RECONCILED config and the provider-owned required-field topology, so both must be
    // the REAL implementations (the fake identities would neither substitute masks nor flag missing leaves).
    provider.config.reconcileSecrets = (incoming, previous) => real.reconcileSecrets(incoming, previous);
    provider.config.missingConnectionFields = (block) => real.missingConnectionFields(block);
  });

  test('missing publicKey: rejected with a field-level 400, nothing persisted, no probe', async () => {
    const { publicKey, ...withoutPublic } = creds();
    void publicKey;

    await expect(
      updateStoreConfig({ env, body: connectBody(withoutPublic), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toMatchObject({
      httpErrorStatus: 400,
      code: 'RequiredField',
    });
    await expect(
      updateStoreConfig({ env, body: connectBody(withoutPublic), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toThrow(/publicKey/);
    expect(provider.introspection.testConnection).not.toHaveBeenCalled();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('missing privateKey: rejected with a field-level 400, nothing persisted', async () => {
    const { privateKey, ...withoutPrivate } = creds();
    void privateKey;

    await expect(
      updateStoreConfig({ env, body: connectBody(withoutPrivate), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toMatchObject({ httpErrorStatus: 400, code: 'RequiredField' });
    await expect(
      updateStoreConfig({ env, body: connectBody(withoutPrivate), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toThrow(/privateKey/);
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('both present: accepted — probes then writes', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 1 });

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('an environment with no credentials is not gated (a settings-only save is untouched)', async () => {
    await updateStoreConfig({ env, body: { mode: 'live' }, storeKey: 'de-store' }, { ports, provider });
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('unedited masked re-save: passes the gate and preserves the stored key pair', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds() } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: undefined });

    const write = jest.fn<typeof ports.configStore.write>().mockResolvedValue({});
    ports.configStore.write = write;

    const masked = connectBody(creds({ publicKey: '***', privateKey: '***' }));
    await updateStoreConfig({ env, body: masked, storeKey: 'de-store' }, { ports, provider });

    const written = write.mock.calls[0][1] as StoredStoreConfig;
    expect(written.environments?.sandbox?.credentials?.publicKey).toBe('s-pub-key');
    expect(written.environments?.sandbox?.credentials?.privateKey).toBe('s-priv-key');
    // Nothing actually changed, so the live probe is skipped, yet the save still lands.
    expect(provider.introspection.testConnection).not.toHaveBeenCalled();
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('two-env save: an unchanged legacy env (incomplete key pair) does not block connecting the other env', async () => {
    // `formToConfig` always submits both blocks; the `sandbox` block is a legacy env with only a public key
    // whose masked credentials are UNCHANGED, so it must not gate the fresh `live` connect the operator makes.
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: 'k' } } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 4 });

    const body: StoredStoreConfig = {
      mode: 'live',
      environments: {
        sandbox: { credentials: { publicKey: '***' } },
        live: { credentials: creds() },
      },
    };

    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('editing an env’s credentials (changed, incomplete key pair) is rejected fail-closed', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: { publicKey: 'k', privateKey: 's' } } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 2 });

    // A genuine credential edit (a new public key) that omits the mandatory private key.
    const body = connectBody({ publicKey: 'new-pub' });

    await expect(updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider })).rejects.toMatchObject({
      httpErrorStatus: 400,
      code: 'RequiredField',
    });
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });
});
