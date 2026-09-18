import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoreConfig, StoredStoreConfig } from '../src/domain';
import packageJSON from '../package.json';
import { pspManifest } from '../src/providers/psp';
import * as StoreConfigRepo from '../src/infrastructure/persistence/store-config.repository';
import { resolveDefaultStoreConfig, resolveStoreConfig } from '../src/infrastructure/config/resolve-store-config';
import * as Context from '../src/infrastructure/bootstrap/libs/fastify/context/context';
import { resolveStoreKey } from '../src/infrastructure/config/store-key';
import { getConfig } from '../src/infrastructure/config/config';
import { initProviderManifest } from '../src/application/provider-manifest';
import { expectedWebhookToken as expectedToken } from './support/webhook-token';

// resolveStoreConfig deep-merges two Custom Object layers (the `__default__` scope ▷ the store's own) and
// is async (it fetches them per request, no cache). There is no environment layer and no credential
// baseline: the Merchant Center connection is the only source of credentials. The `settings` document is
// OPAQUE to core — the resolver passes it through untouched (no validation, no stamping, no default
// fabrication); validation lives at PUT. This connector defines no settings FIELDS — `validatePspConfig`
// admits only `{}`; the deep-merge policy itself (sibling retention, array/scalar wholesale replace,
// __proto__ safety) is proven in `deep-merge.spec.ts`. The Custom Object read is spied so no CT network
// call happens.
const ENV_KEYS = ['CONNECT_SERVICE_URL', 'ENCRYPTION_KEY'] as const;

// A 64-hex-char key is used verbatim as the 32 raw key bytes — so the shared oracle
// (`expectedToken`, the independent replica of the token formula) can derive the key material
// without reaching into the crypto module's private helpers.
const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

// Synthetic back-office portals, one per vendor environment. This distribution ships no back office at
// all - it has no portal to deep-link an operator into, so the all-or-nothing `resolveBackOffice` yields
// `undefined` in BOTH modes. Deriving the expectations from those defaults would therefore compare
// `undefined` with `undefined` and hold whichever environment the resolver picked. Two distinguishable
// synthetic values are what make the mode selection falsifiable.
const SANDBOX_PORTAL = 'https://sandbox-portal.test';
const LIVE_PORTAL = 'https://live-portal.test';

/**
 * Inject a manifest whose brand defaults name both portals, through the same `initProviderManifest`
 * seam `composition-root.ts` (and `test/jest.setup.ts`) uses.
 */
function injectBackOfficePortals(): void {
  initProviderManifest({
    ...pspManifest,
    brandDefaults: { ...pspManifest.brandDefaults, backOffice: { test: SANDBOX_PORTAL, live: LIVE_PORTAL } },
  });
}

/** A stored connection document, as the Merchant Center saves it. */
const stored = (document: Partial<StoredStoreConfig>): StoredStoreConfig => document as StoredStoreConfig;

describe('resolveStoreConfig (layered: the __default__ scope ▷ the store’s own Custom Object)', () => {
  const saved: Record<string, string | undefined> = {};
  let readSpy: jest.SpiedFunction<typeof StoreConfigRepo.readStoreConfigObjects>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Default: no merchant-authored objects at all (neither the default scope nor a per-store override).
    readSpy = jest.spyOn(StoreConfigRepo, 'readStoreConfigObjects').mockResolvedValue({});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    // Put the distribution's real manifest back: the back-office tests replace it with a synthetic one,
    // and the injection is a process-wide singleton.
    initProviderManifest(pspManifest);
    jest.restoreAllMocks();
  });

  it('maps the stored credentials into a well-formed StoreConfig', async () => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://proc.example.test' });
    readSpy.mockResolvedValue({
      'main-store': stored({
        environments: { sandbox: { credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' } } },
      }),
    });

    const cfg: StoreConfig = await resolveStoreConfig('main-store');

    // Host, integrator and telemetry name are brand-only: no deployment env var reaches them, so a
    // sandbox-mode store resolves the brand's sandbox host and the brand's own identity.
    expect(cfg.host).toBe(pspManifest.brandDefaults.defaultHost);
    expect(cfg.integrator).toBe(pspManifest.brandDefaults.integrator);
    expect(cfg.telemetry.name).toBe(pspManifest.brandDefaults.telemetryHeaderName);
    expect(cfg.credentials).toEqual({ publicKey: 's-pub-key', privateKey: 's-priv-key' });
    // The webhook URL is DERIVED, not configured: the current public origin + the store's own webhook
    // route plus the derived MAC token segment - the capability URL.
    expect(cfg.endpoints.webhookUrl).toBe(
      `https://proc.example.test/webhooks/main-store/${expectedToken(TEST_ENCRYPTION_KEY, 'main-store')}`,
    );
    // The token tail is 43 base64url chars, no padding — URL-safe by construction.
    expect(cfg.endpoints.webhookUrl).toMatch(/\/webhooks\/main-store\/[A-Za-z0-9_-]{43}$/);
    // The vendor-call bound is threaded onto the StoreConfig, so the provider reads no environment
    // of its own; so is the brand's custom-Type key, which the provider stamps on every CT Payment.
    expect(cfg.requestTimeoutMs).toBe(30000);
    expect(cfg.paymentTypeKey).toBe(pspManifest.brandDefaults.paymentTypeKey);
    // This connector carries no settings document — the resolved config carries none.
    expect(cfg.settings).toBeUndefined();
    expect(readSpy).toHaveBeenCalledWith(['__default__', 'main-store']);
  });

  it('resolves the brand SANDBOX host for a sandbox store and the brand LIVE host for a live store', async () => {
    const testCfg = await resolveStoreConfig('main-store'); // no stored mode → 'sandbox'
    expect(testCfg.host).toBe(pspManifest.brandDefaults.defaultHost);

    readSpy.mockResolvedValue({ 'main-store': stored({ mode: 'live' }) });
    const liveCfg = await resolveStoreConfig('main-store');
    expect(liveCfg.host).toBe(pspManifest.brandDefaults.defaultHostLive);
    expect(pspManifest.brandDefaults.defaultHostLive).not.toBe(pspManifest.brandDefaults.defaultHost);
  });

  it('derives the webhook URL from the request-derived origin', async () => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://derived.example' });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.endpoints.webhookUrl).toBe(
      `https://derived.example/webhooks/main-store/${expectedToken(TEST_ENCRYPTION_KEY, 'main-store')}`,
    );
  });

  it('resolves empty credentials when no connection is stored', async () => {
    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.credentials).toEqual({});
    expect(cfg.mode).toBe('sandbox');
  });

  it('leaves the webhook URL undefined when no origin is in scope', async () => {
    // ENCRYPTION_KEY is set so the missing origin is the isolated cause.
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.endpoints.webhookUrl).toBeUndefined();
  });

  it('leaves the webhook URL undefined when ENCRYPTION_KEY is unset (totality, same as no origin)', async () => {
    // Totality only — `webhookUrlToken` cannot mint without the key. A keyless deployment mints no URL
    // and has its connect rejected with "no public webhook URL is resolved for this store".
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://proc.example.test' });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.endpoints.webhookUrl).toBeUndefined();
  });

  it('builds the connector identity the vendor is told about — npm author, brand cart label, our version', async () => {
    // The other half of the telemetry contract. `telemetry.spec.ts` proves this identity reaches the
    // WIRE (in both headers); this proves the resolver assembles it from the right three sources, so
    // each distribution announces its OWN cart label rather than the base brand.
    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.connector).toEqual({
      creator: packageJSON.author,
      name: pspManifest.brandDefaults.shoppingCartExtension,
      version: packageJSON.version,
    });
  });

  it('passes an opaque settings document through untouched — no mode stamp, no default fabrication', async () => {
    readSpy.mockResolvedValue({ 'main-store': stored({ settings: {} }) });

    const cfg = await resolveStoreConfig('main-store');

    // The empty settings doc rides through verbatim; the resolver never stamps mode into it.
    expect(cfg.settings).toEqual({});
    expect((cfg.settings as { mode?: string }).mode).toBeUndefined();
  });

  it('selects the live-environment credentials/host/webhook when mode is live', async () => {
    // Set the public origin AND the encryption key too: the env-block webhookUrl must beat a fully
    // mintable DERIVED URL, not just an unset one.
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://proc.example.test' });
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    readSpy.mockResolvedValue({
      'main-store': stored({
        mode: 'live',
        environments: {
          sandbox: { credentials: { publicKey: 'test-key' }, host: 'test.host' },
          live: { credentials: { publicKey: 'live-key' }, host: 'live.host', webhookUrl: 'https://live/hook' },
        },
      }),
    });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.credentials.publicKey).toBe('live-key');
    expect(cfg.host).toBe('live.host');
    expect(cfg.endpoints.webhookUrl).toBe('https://live/hook');
  });

  it("selects the sandbox-environment block by default (mode absent → 'sandbox')", async () => {
    readSpy.mockResolvedValue({
      'main-store': stored({
        environments: {
          sandbox: { credentials: { publicKey: 'test-key' }, host: 'test.host' },
          live: { credentials: { publicKey: 'live-key' } },
        },
      }),
    });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.credentials.publicKey).toBe('test-key');
    expect(cfg.host).toBe('test.host');
  });

  // The provider builds its per-payment back-office deep link on this base URL, so the ACTIVE
  // environment must decide it: a live payment may never resolve to the sandbox portal, or vice versa.
  it('resolves the SANDBOX back-office base URL when mode is sandbox (the default)', async () => {
    injectBackOfficePortals();

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.endpoints.backOfficeBaseUrl).toBe(SANDBOX_PORTAL);
  });

  it('resolves the LIVE back-office base URL when mode is live', async () => {
    injectBackOfficePortals();
    readSpy.mockResolvedValue({ 'main-store': stored({ mode: 'live' }) });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.endpoints.backOfficeBaseUrl).toBe(LIVE_PORTAL);
  });

  it('ignores a stray mode inside a settings doc — only the envelope selects the environment', async () => {
    // A Custom Object settings doc smuggling `mode: 'live'` (the strict provider schema rejects it on
    // write, but the resolver treats settings as opaque): it must NOT select the live block.
    readSpy.mockResolvedValue({
      'main-store': stored({
        settings: { mode: 'live' },
        environments: {
          sandbox: { credentials: { publicKey: 'test-key' } },
          live: { credentials: { publicKey: 'live-key' } },
        },
      }),
    });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.credentials.publicKey).toBe('test-key');
  });

  it('lets the store’s own credentials win over the default scope, siblings kept', async () => {
    readSpy.mockResolvedValue({
      __default__: stored({
        environments: { sandbox: { credentials: { publicKey: 'default-key', privateKey: 'default-secret' } } },
      }),
      'main-store': stored({ environments: { sandbox: { credentials: { publicKey: 'store-key' } } } }),
    });

    const cfg = await resolveStoreConfig('main-store');

    expect(cfg.credentials.publicKey).toBe('store-key'); // store layer wins on the shared key
    expect(cfg.credentials.privateKey).toBe('default-secret'); // sibling kept from default (deep-merge)
  });

  it('merges a store settings doc over the default scope one with __proto__ skipped, not rebound', async () => {
    // The resolver routes the opaque settings document through `deepMerge` like any other envelope key,
    // so the forbidden-key check guards it — but only when a LOWER layer carries `settings` too:
    // without one the merge short-circuits on `base === undefined` and returns the document by
    // reference, never entering the key loop. `{}` is the only settings doc this connector's
    // `validateSettings` admits, and it is enough to make the merge recurse. The override is built via
    // JSON.parse because only JSON parsing creates '__proto__' as an OWN key (an object literal sets
    // the prototype instead), which is exactly how the Custom Object's parsed body can carry it.
    readSpy.mockResolvedValue({
      __default__: stored({ settings: {} }),
      'main-store': JSON.parse('{"settings": {"__proto__": {"polluted": 1}}}'),
    });

    const cfg = await resolveStoreConfig('main-store');

    expect(Object.getPrototypeOf(cfg.settings)).toBe(Object.prototype);
    expect((cfg.settings as { polluted?: number }).polluted).toBeUndefined();
  });

  it('threads the storeKey through and fetches the Custom Object per request (no cache)', async () => {
    const a = await resolveStoreConfig('store-a');
    const b = await resolveStoreConfig('store-b');

    expect(a.storeKey).toBe('store-a');
    expect(b.storeKey).toBe('store-b');
    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(readSpy).toHaveBeenNthCalledWith(1, ['__default__', 'store-a']);
    expect(readSpy).toHaveBeenNthCalledWith(2, ['__default__', 'store-b']);
  });

  /**
   * `inheritsDefaultScope` answers ONE question - did this store bring a connection of its own? - and the
   * per-method configuration keys its own inheritance off it. It is free to answer here: both
   * layers came back in the single query above.
   */
  it('marks a store with its own Custom Object as inheriting nothing', async () => {
    readSpy.mockResolvedValue({ 'main-store': stored({ settings: { mode: 'sandbox' } }) });

    await expect(resolveStoreConfig('main-store')).resolves.toMatchObject({ inheritsDefaultScope: false });
  });

  it('marks a store with no object of its own as inheriting the default scope', async () => {
    readSpy.mockResolvedValue({ __default__: stored({ settings: { mode: 'sandbox' } }) });

    await expect(resolveStoreConfig('main-store')).resolves.toMatchObject({ inheritsDefaultScope: true });
  });
});

describe('resolveDefaultStoreConfig (no-store shopper path: the __default__ scope alone)', () => {
  const saved: Record<string, string | undefined> = {};
  let readSpy: jest.SpiedFunction<typeof StoreConfigRepo.readStoreConfigObject>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    readSpy = jest.spyOn(StoreConfigRepo, 'readStoreConfigObject').mockResolvedValue(null);
    // The 'identical credentials' case runs the PER-STORE resolve too, which reads the batch.
    jest.spyOn(StoreConfigRepo, 'readStoreConfigObjects').mockResolvedValue({});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    jest.restoreAllMocks();
  });

  it('resolves the __default__ scope and never a per-store override', async () => {
    const cfg = await resolveDefaultStoreConfig();

    expect(cfg.settings).toBeUndefined();
    // The no-store path reads NO per-store override — only the merchant-authored default scope
    // (`__default__`), so a no-store cart follows the default the Connection screen shows.
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith('__default__');
  });

  it('a no-store create and a later resolve(projectKey) yield identical credentials', async () => {
    // The bug this pins: a no-store create leg resolves the default scope and stamps the project key,
    // while the return/webhook/MC legs run resolve(projectKey). The project key is reserved, so no
    // Custom Object exists under it and the two legs resolve identical credentials/host/webhook.
    readSpy.mockResolvedValue(
      stored({ environments: { sandbox: { credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' } } } }),
    );

    const created = await resolveDefaultStoreConfig();
    const later = await resolveStoreConfig(resolveStoreKey());

    expect(later.storeKey).toBe(created.storeKey);
    expect(later.host).toBe(created.host);
  });

  it('applies the stored credentials and brand identity through the shared tail', async () => {
    readSpy.mockResolvedValue(
      stored({ environments: { sandbox: { credentials: { publicKey: 's-pub-key', privateKey: 's-priv-key' } } } }),
    );

    const cfg = await resolveDefaultStoreConfig();

    // Host is brand-only: a sandbox-mode store resolves the brand's sandbox host.
    expect(cfg.host).toBe(pspManifest.brandDefaults.defaultHost);
    expect(cfg.credentials).toEqual({ publicKey: 's-pub-key', privateKey: 's-priv-key' });
    // Labelled with the CT project key (a label only — no per-store layering was applied): the label
    // becomes the webhook reconciler's store scope, so it is compared against `getConfig().projectKey`
    // rather than against `resolveStoreKey()`, which the resolver itself calls and which would agree
    // with any label the resolver happened to stamp.
    expect(cfg.storeKey).toBe(getConfig().projectKey);
    expect(readSpy).toHaveBeenCalledWith('__default__');
  });
});
