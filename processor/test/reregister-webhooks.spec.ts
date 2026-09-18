import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ProviderModule } from '../src/application/handlers';
import type { StoreConfig, StoredStoreConfig } from '../src/domain';
import * as StoreConfigRepo from '../src/infrastructure/persistence/store-config.repository';
import * as ResolveStoreConfig from '../src/infrastructure/config/resolve-store-config';
import { reregisterWebhooks } from '../src/infrastructure/connectors/reregister-webhooks';
import { webhookUrlToken } from '../src/infrastructure/crypto/crypto';

// The walk is driven through module-namespace spies at the SEAMS it composes - the repository list
// (`listStoreConfigObjects`, raw at-rest values, same source the re-encryption walk uses) and the
// per-env resolution (`resolveStoreConfig(storeKey, modeOverride)`) - plus a fake provider webhook
// handler capturing every vendor call in order. No CT client or env-settings scaffolding is needed:
// what THIS suite pins is the walk itself (condition gate, env selection, delete-before-register,
// the eventUrl handed to the vendor, the register retry + stranded signal, the stale-override
// warning, best-effort continuation, the summary line).

/** The current key the fake keyring mints tokens with (the walk's stale-override check re-mints). */
const CURRENT_KEY = 'a'.repeat(64);

/** The deterministic DERIVED webhook URL per store - trailing segment = the real current-key mint. */
const urlFor = (storeKey: string): string => `https://proc.example/webhooks/${storeKey}/${webhookUrlToken(storeKey)}`;

/** A minimal resolved config carrying only what the walk reads (storeKey, mode, endpoints). */
const resolvedCfg = (storeKey: string, mode: 'sandbox' | 'live', webhookUrl?: string): StoreConfig =>
  ({ storeKey, mode, endpoints: { webhookUrl } }) as StoreConfig;

/** A stored (at-rest) object entry as `listStoreConfigObjects` returns it. */
const entry = (key: string, value: StoredStoreConfig, version = 1) => ({ key, value, version });

/** An environment block holding a credential leaf (values are opaque at-rest ciphertext here). */
const credentialed = () => ({ credentials: { publicKey: 'enc-pub', privateKey: 'enc-priv' } });

/**
 * A credentialed environment whose subscription ids the connect flow recorded. The delete is targeted at
 * exactly these: an account-wide delete on a keypair two stores share takes the other store's
 * subscriptions with it, and the rotation walk is where that would happen silently.
 */
const credentialedWithIds = (...webhookIds: string[]) => ({ ...credentialed(), webhookIds });

describe('config/reregister-webhooks - post-deploy webhook re-registration on rotation', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalPrev = process.env.ENCRYPTION_KEY_PREVIOUS;

  /** Every vendor call in arrival order - the delete-before-register assertions read this. */
  let vendorCalls: string[];
  let registerMock: jest.Mock<(cfg: StoreConfig, eventUrl: string) => Promise<void>>;
  let deleteMock: jest.Mock<(cfg: StoreConfig, ids?: string[]) => Promise<void>>;
  let provider: ProviderModule;
  let listSpy: jest.SpiedFunction<typeof StoreConfigRepo.listStoreConfigObjects>;
  let resolveSpy: jest.SpiedFunction<typeof ResolveStoreConfig.resolveStoreConfig>;
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CURRENT_KEY;
    process.env.ENCRYPTION_KEY_PREVIOUS = 'b'.repeat(64);

    vendorCalls = [];
    registerMock = jest.fn<(cfg: StoreConfig, eventUrl: string) => Promise<void>>(async (cfg, eventUrl) => {
      vendorCalls.push(`register:${cfg.storeKey}:${cfg.mode}:${eventUrl}`);
    });
    deleteMock = jest.fn<(cfg: StoreConfig, ids?: string[]) => Promise<void>>(async (cfg, ids) => {
      vendorCalls.push(`delete:${cfg.storeKey}:${cfg.mode}:${(ids ?? []).join('+')}`);
    });
    provider = { webhook: { registerWebhooks: registerMock, deleteWebhooks: deleteMock } } as unknown as ProviderModule;

    listSpy = jest.spyOn(StoreConfigRepo, 'listStoreConfigObjects').mockResolvedValue([]);
    resolveSpy = jest
      .spyOn(ResolveStoreConfig, 'resolveStoreConfig')
      .mockImplementation(async (storeKey, modeOverride) => {
        const mode = modeOverride ?? 'sandbox';
        return resolvedCfg(storeKey, mode, urlFor(storeKey));
      });

    stdout = [];
    stderr = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalPrev === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = originalPrev;
  });

  it('(a) does nothing - no list, no resolve, no vendor call - when no previous key is configured', async () => {
    delete process.env.ENCRYPTION_KEY_PREVIOUS;

    await reregisterWebhooks(provider);

    expect(listSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(vendorCalls).toEqual([]);
  });

  it('(a2) a blank previous key is the same no-op as an unset one', async () => {
    process.env.ENCRYPTION_KEY_PREVIOUS = '   ';

    await reregisterWebhooks(provider);

    expect(listSpy).not.toHaveBeenCalled();
    expect(vendorCalls).toEqual([]);
  });

  it('(b) walks every credentialed store environment: per-env mode-override resolve, delete BEFORE register, eventUrl = the resolved webhookUrl', async () => {
    listSpy.mockResolvedValue([
      entry('store-a', { mode: 'sandbox', environments: { sandbox: credentialed(), live: credentialed() } }),
      entry('store-b', { mode: 'live', environments: { live: credentialed() } }),
    ]);

    await reregisterWebhooks(provider);

    // Each credentialed env resolved with ITS mode override - the same per-env semantics the connect flow uses.
    expect(resolveSpy.mock.calls).toEqual([
      ['store-a', 'sandbox'],
      ['store-a', 'live'],
      ['store-b', 'live'],
    ]);
    // Per env: the keypair's subscriptions are dropped, then the CURRENT-key URL is registered.
    expect(vendorCalls).toEqual([
      'delete:store-a:sandbox:',
      `register:store-a:sandbox:${urlFor('store-a')}`,
      'delete:store-a:live:',
      `register:store-a:live:${urlFor('store-a')}`,
      'delete:store-b:live:',
      `register:store-b:live:${urlFor('store-b')}`,
    ]);
    expect(stdout.join('')).toContain('webhook re-registration: 3 of 3 store environment(s) re-registered');
    // A derived URL carries the current-key token - no stale-override warning, nothing stranded.
    expect(stderr.join('')).toBe('');
  });

  // The delete targets the ids the connect flow recorded on the environment, never the whole keypair: two
  // commercetools stores may share one Unzer account, and an account-wide delete would take the other
  // store's subscriptions down on a key rotation and leave it receiving nothing.
  it('(b2) deletes exactly the subscription ids the environment recorded', async () => {
    listSpy.mockResolvedValue([
      entry('store-a', {
        mode: 'sandbox',
        environments: { sandbox: credentialedWithIds('wh-1', 'wh-2'), live: credentialedWithIds('wh-9') },
      }),
    ]);

    await reregisterWebhooks(provider);

    expect(deleteMock.mock.calls.map(([, ids]) => ids)).toEqual([['wh-1', 'wh-2'], ['wh-9']]);
  });

  it('(c) skips environments without credentials (absent block, block without credentials, empty credentials bag)', async () => {
    listSpy.mockResolvedValue([
      entry('store-c', {
        mode: 'sandbox',
        environments: { sandbox: { host: 'https://api.example' }, live: { credentials: {} } },
      }),
    ]);

    await reregisterWebhooks(provider);

    // Nothing was ever registered without credentials - nothing to migrate, no resolve, no vendor call.
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(vendorCalls).toEqual([]);
    expect(stdout.join('')).toContain('webhook re-registration: 0 of 0 store environment(s) re-registered');
  });

  it('(d) a register failure after a successful delete is retried ONCE; a second failure emits the STRANDED signal (token redacted) and counts separately', async () => {
    listSpy.mockResolvedValue([
      entry('store-a', { mode: 'sandbox', environments: { sandbox: credentialed() } }),
      entry('store-b', { mode: 'sandbox', environments: { sandbox: credentialed() } }),
    ]);
    // The vendor error echoes the registered URL - the log line must carry it token-REDACTED.
    const vendorReject = async () => {
      throw new Error(`vendor rejected the subscription for ${urlFor('store-a')}`);
    };
    registerMock.mockImplementationOnce(vendorReject).mockImplementationOnce(vendorReject);

    await reregisterWebhooks(provider);

    // The retry happened: two register attempts for store-a, then store-b's single success.
    expect(registerMock).toHaveBeenCalledTimes(3);
    expect(vendorCalls).toContain(`register:store-b:sandbox:${urlFor('store-b')}`);
    // The stranded signal is DISTINCT from a plain failure: it names the store, the mode, and that the
    // environment is left WITHOUT a subscription and needs a re-connect - with the token redacted.
    const strandedLine = stdout.join('');
    expect(strandedLine).toContain('STRANDED');
    expect(strandedLine).toContain('store-a');
    expect(strandedLine).toContain('sandbox');
    expect(strandedLine).toContain('re-connect');
    expect(strandedLine).toContain('/webhooks/store-a/<redacted>');
    expect(strandedLine).not.toContain(webhookUrlToken('store-a'));
    expect(stdout.join('')).toContain('webhook re-registration: 1 of 2 store environment(s) re-registered, 1 stranded');
  });

  it('(d2) a TRANSIENT register failure recovers on the retry - the environment is re-registered, nothing stranded', async () => {
    listSpy.mockResolvedValue([entry('store-a', { mode: 'sandbox', environments: { sandbox: credentialed() } })]);
    registerMock.mockImplementationOnce(async () => {
      throw new Error('vendor 503');
    });

    await reregisterWebhooks(provider);

    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(stdout.join('')).not.toContain('STRANDED');
    expect(stdout.join('')).toContain('webhook re-registration: 1 of 1 store environment(s) re-registered');
  });

  it('(d3) a DELETE failure is a plain best-effort failure line - the old subscription still stands, no register attempt, nothing stranded', async () => {
    listSpy.mockResolvedValue([
      entry('store-a', { mode: 'sandbox', environments: { sandbox: credentialed() } }),
      entry('store-b', { mode: 'sandbox', environments: { sandbox: credentialed() } }),
    ]);
    deleteMock.mockImplementationOnce(async () => {
      throw new Error('vendor unavailable');
    });

    await reregisterWebhooks(provider);

    // store-a: no register without the delete (its OLD subscription keeps delivering via the
    // previous-key window); store-b still walked after the failure.
    expect(vendorCalls).toEqual(['delete:store-b:sandbox:', `register:store-b:sandbox:${urlFor('store-b')}`]);
    const failureLine = stdout.join('');
    expect(failureLine).toContain('failed for store "store-a" (sandbox)');
    expect(failureLine).toContain('vendor unavailable');
    expect(failureLine).not.toContain('STRANDED');
    expect(stdout.join('')).toContain('webhook re-registration: 1 of 2 store environment(s) re-registered');
  });

  it('(e) an environment whose resolved config carries no webhook URL is logged and skipped - no delete without a URL to re-register', async () => {
    listSpy.mockResolvedValue([entry('store-x', { mode: 'sandbox', environments: { sandbox: credentialed() } })]);
    resolveSpy.mockImplementation(async (storeKey, modeOverride) =>
      resolvedCfg(storeKey, modeOverride ?? 'sandbox', undefined),
    );

    await reregisterWebhooks(provider);

    expect(vendorCalls).toEqual([]);
    expect(stdout.join('')).toContain('store-x');
    expect(stdout.join('')).toContain('webhook re-registration: 0 of 1 store environment(s) re-registered');
  });

  it('(f) a webhookUrl OVERRIDE whose trailing segment is not the CURRENT-key token warns to re-derive it before dropping the previous key - and still re-registers it verbatim', async () => {
    const staleOverride = `https://tunnel.example/webhooks/store-a/${webhookUrlToken('stale-derivation-source')}`;
    listSpy.mockResolvedValue([entry('store-a', { mode: 'sandbox', environments: { sandbox: credentialed() } })]);
    resolveSpy.mockImplementation(async (storeKey, modeOverride) =>
      resolvedCfg(storeKey, modeOverride ?? 'sandbox', staleOverride),
    );

    await reregisterWebhooks(provider);

    // The override wins verbatim everywhere, so the walk re-registers it as-is …
    expect(vendorCalls).toEqual(['delete:store-a:sandbox:', `register:store-a:sandbox:${staleOverride}`]);
    expect(stdout.join('')).toContain('webhook re-registration: 1 of 1 store environment(s) re-registered');
    // … but warns the operator: this URL stops verifying the moment ENCRYPTION_KEY_PREVIOUS is dropped.
    const warningLine = stdout.join('');
    expect(warningLine).toContain('store-a');
    expect(warningLine).toContain('ENCRYPTION_KEY_PREVIOUS');
    expect(warningLine).toContain('re-derive');
    // The warning itself never carries a token.
    expect(warningLine).not.toContain(webhookUrlToken('stale-derivation-source'));
  });
});
