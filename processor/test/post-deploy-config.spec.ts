import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Post-deploy is the encryption-key rotation and nothing else: it NEVER touches the store-config Custom
// Object (PUT /operations/store-config is its only writer) and provisions nothing (saving a connection
// does that). The composition root is mocked so `postDeploy` itself executes for real: the suite asserts
// the hard guards (credentials, encryption key) reject BEFORE either rotation walk, that the walks run in
// order, and that the repository write path stays unreached on every path.
jest.mock('../src/composition-root', () => ({
  provider: { key: 'fake-provider' },
}));

jest.mock('../src/infrastructure/persistence/store-config.repository', () => ({
  readStoreConfigObject: jest.fn(),
  writeStoreConfigObject: jest.fn(),
}));

jest.mock('../src/infrastructure/config/config', () => ({
  getConfig: () => ({ projectKey: 'project-key-fallback' }),
}));

// The two rotation walks are unit-covered in their own suites (reencrypt.spec, reregister-webhooks.spec);
// here they are mocked so this suite can assert post-deploy CALLS them - reencrypt first, then the
// webhook re-registration with the composed provider - without any CT/vendor scaffolding.
jest.mock('../src/infrastructure/connectors/reencrypt', () => ({
  reencryptStoreConfigs: jest.fn(),
}));

jest.mock('../src/infrastructure/connectors/reregister-webhooks', () => ({
  reregisterWebhooks: jest.fn(),
}));

import { postDeploy } from '../src/infrastructure/connectors/post-deploy';
import { provider } from '../src/composition-root';
import { reencryptStoreConfigs } from '../src/infrastructure/connectors/reencrypt';
import { reregisterWebhooks } from '../src/infrastructure/connectors/reregister-webhooks';
import { writeStoreConfigObject } from '../src/infrastructure/persistence/store-config.repository';
import { resolveStoreKey } from '../src/infrastructure/config/store-key';

const reencryptMock = reencryptStoreConfigs as jest.MockedFunction<typeof reencryptStoreConfigs>;
const reregisterMock = reregisterWebhooks as jest.MockedFunction<typeof reregisterWebhooks>;
const writeMock = writeStoreConfigObject as jest.MockedFunction<typeof writeStoreConfigObject>;

describe('connectors/post-deploy - the key rotation, and nothing else', () => {
  /**
   * `post-deploy.ts` does `import 'dotenv/config'`, so a developer's gitignored `processor/.env` would
   * otherwise supply these and hide a guard's behaviour from this suite - green locally, red on CI. Every
   * case therefore states the environment it wants, and every variable a guard reads is cleared first.
   */
  const GUARDED_VARS = [
    'ENCRYPTION_KEY',
    'ENCRYPTION_KEY_PREVIOUS',
    'CTP_PROJECT_KEY',
    'CTP_CLIENT_ID',
    'CTP_CLIENT_SECRET',
  ] as const;

  /** A strong key, so a case about something else is not stopped by the key guards. */
  const STRONG_KEY = 'a'.repeat(64);

  /** The credentials every case but the credentials case itself needs, so the guard lets it through. */
  const withCommercetoolsCredentials = () => {
    process.env.CTP_PROJECT_KEY = 'project-key-fallback';
    process.env.CTP_CLIENT_ID = 'client-id';
    process.env.CTP_CLIENT_SECRET = 'client-secret';
  };

  const original = new Map(GUARDED_VARS.map((name) => [name, process.env[name]] as const));

  beforeEach(() => {
    jest.clearAllMocks();
    GUARDED_VARS.forEach((name) => delete process.env[name]);
  });

  afterEach(() => {
    GUARDED_VARS.forEach((name) => {
      const value = original.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it('store key is the CT project key (no env override)', () => {
    expect(resolveStoreKey()).toBe('project-key-fallback');
  });

  it('runs the rotation walks in order - re-encryption, then webhook re-registration with the composed provider', async () => {
    withCommercetoolsCredentials();
    process.env.ENCRYPTION_KEY = STRONG_KEY;

    await expect(postDeploy()).resolves.toBeUndefined();

    // Both walks are invoked unconditionally - each self-gates on ENCRYPTION_KEY_PREVIOUS (no-op
    // without it). The re-registration receives the ONE provider the composition root wires, and runs
    // AFTER the re-encryption - the property the next test pins by its consequence.
    expect(reencryptMock).toHaveBeenCalledTimes(1);
    expect(reregisterMock).toHaveBeenCalledTimes(1);
    expect(reregisterMock).toHaveBeenCalledWith(provider);
    expect(reregisterMock.mock.invocationCallOrder[0]).toBeGreaterThan(reencryptMock.mock.invocationCallOrder[0]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  // What the order BUYS, which call-order alone does not pin: `reencryptStoreConfigs` swallows nothing, so
  // an unreadable stored secret aborts the deploy before the re-registration walk deletes a single live
  // vendor subscription. Run concurrently - or reversed - a deployment that cannot read its own secrets
  // would drop those subscriptions on its way to failing, and every store would stop receiving webhooks
  // until an operator noticed.
  it('a failing re-encryption aborts the deploy BEFORE any vendor subscription is deleted', async () => {
    withCommercetoolsCredentials();
    process.env.ENCRYPTION_KEY = STRONG_KEY;
    const unreadable = new Error('stored secret is unreadable under either key');
    // `Once` is CONSUMED by this deploy's single call - which the assertion below pins - so no later test
    // inherits the rejection. (`clearAllMocks` alone would not: an unconsumed once-rejection survives it.)
    reencryptMock.mockRejectedValueOnce(unreadable);

    await expect(postDeploy()).rejects.toBe(unreadable);

    expect(reencryptMock).toHaveBeenCalledTimes(1);
    expect(reregisterMock).not.toHaveBeenCalled();
  });

  /**
   * The commercetools credentials are the first thing post-deploy asserts, and the reason is `config.ts`:
   * an unset project key or client id falls back to a placeholder there, so without this guard a
   * deployment configured with neither would install and fail on the first real call.
   */
  it('UNSET commercetools credentials reject before either rotation walk, naming every missing one', async () => {
    process.env.ENCRYPTION_KEY = STRONG_KEY;

    await expect(postDeploy()).rejects.toThrow(/CTP_PROJECT_KEY, CTP_CLIENT_ID, CTP_CLIENT_SECRET are required/);

    expect(reencryptMock).not.toHaveBeenCalled();
    expect(reregisterMock).not.toHaveBeenCalled();
  });

  // The key is not optional at deploy time: the webhook capability URL is derived from it and every
  // stored secret is sealed with it, so a deploy without one would register URLs it cannot verify later.
  it('an UNSET ENCRYPTION_KEY rejects before either rotation walk', async () => {
    withCommercetoolsCredentials();

    await expect(postDeploy()).rejects.toThrow(/ENCRYPTION_KEY is required/);

    expect(reencryptMock).not.toHaveBeenCalled();
    expect(reregisterMock).not.toHaveBeenCalled();
  });

  // `reregisterWebhooks` mints capability URLs from ENCRYPTION_KEY and registers them with the vendor,
  // and post-deploy runs BEFORE the container start that carries `main.ts`'s strength guard. A weak key
  // must therefore fail the deploy here, before a guessable URL reaches Unzer for any store.
  it('a weak ENCRYPTION_KEY rejects BEFORE the webhook re-registration walk publishes any URL', async () => {
    withCommercetoolsCredentials();
    process.env.ENCRYPTION_KEY = 'replace-with-openssl-rand-hex-32';

    await expect(postDeploy()).rejects.toThrow(/openssl rand -hex 32/);

    expect(reregisterMock).not.toHaveBeenCalled();
    expect(reencryptMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('a weak ENCRYPTION_KEY_PREVIOUS rejects too - it is an accepted token derivation', async () => {
    withCommercetoolsCredentials();
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.ENCRYPTION_KEY_PREVIOUS = 'short';

    await expect(postDeploy()).rejects.toThrow(/ENCRYPTION_KEY_PREVIOUS/);

    expect(reregisterMock).not.toHaveBeenCalled();
  });
});
