/**
 * The server-authoritative connect on `PUT /operations/store-config`.
 *
 * The orchestrator probes the live provider (Unzer keypair validation) with the REQUEST-BODY
 * credentials, then registers the Unzer webhook(s) for every environment being connected, and only
 * then writes: a keypair rejection OR a webhook-registration failure aborts with a 4xx and persists
 * nothing; if the CAS write itself fails after webhooks were registered, they are best-effort deleted
 * to avoid orphaning. An unedited masked (`***`) save resolves to unchanged credentials and is neither
 * re-probed nor re-registered. The integration block drives the REAL introspection service of the
 * built-in psp provider against a FAKE `PspClient`, proving the per-environment `mode` (which
 * selects the sandbox-vs-live Unzer host) reaches the client.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Errorx } from '@commercetools/connect-payments-sdk';
import { DEFAULT_SCOPE_STORE_KEY } from '../src/domain';
import { updateStoreConfig } from '../src/application/orchestration';
import { FAKE_WEBHOOK_URL, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { PspConfigHandler } from '../src/providers/psp/config/config.handler';
import { PspIntrospectionService } from '../src/providers/psp/introspection/introspection.service';
import { PspError } from '../src/providers/psp';
import type { KeypairResult, PspClient, PspConnectionConfig } from '../src/providers/psp/client';
import type { StoreConfig, StoredStoreConfig } from '../src/domain';

/** The full active-environment credentials bag MC always submits (the Unzer public/private key pair). */
const creds = (overrides: Record<string, string> = {}) => ({
  publicKey: 's-pub-key',
  privateKey: 's-priv-key',
  ...overrides,
});

/** A minimal configured payment method — the shape the methods Custom Object holds per environment. */
const methodConfig = (paymentMethodCode: string) => ({
  paymentMethodCode,
  enabled: true,
  name: {},
  description: {},
  surcharge: {},
  countries: [],
  sendBasketData: false,
});

/** A connect body for the `sandbox` environment carrying real (non-masked) credentials. */
const connectBody = (credentials: Record<string, string>): StoredStoreConfig => ({
  mode: 'sandbox',
  environments: { sandbox: { credentials, webhookSecret: 'wh-secret' } },
});

describe('updateStoreConfig — validate-before-save gate (fake provider)', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();
  const realConfig = new PspConfigHandler();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    // The gate's "changed?" decision reads the reconciled credentials, so the REAL masking reconcile
    // must run (the fake identity stub would treat an unedited `***` as a brand-new credential).
    provider.config.reconcileSecrets = (incoming, previous) => realConfig.reconcileSecrets(incoming, previous);
  });

  test('valid credentials: probes with the request-body overlay, then writes', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 2 });
    let probed: StoreConfig | undefined;
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockImplementation(async (cfg) => {
        probed = cfg;
        return { success: true };
      });

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(probed?.credentials).toMatchObject(creds());
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('the PUT response carries the credentials IN THE CLEAR, never the at-rest ciphertext', async () => {
    // The regression this pins: the write used to answer with commercetools' echo of the ENCRYPTED
    // document, which `redact` then passed through untouched (keeps credentials unmasked), so the
    // merchant screen re-seeded its form from `v1:<key-id>:…` envelopes.
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 2 });
    provider.config.redact = (stored) => realConfig.redact(stored);

    const response = await updateStoreConfig(
      { env, body: connectBody(creds()), storeKey: 'de-store' },
      { ports, provider },
    );

    expect(response.environments?.sandbox?.credentials).toEqual(creds());
    // The one leaf the read projection DOES mask stays masked.
    expect(response.environments?.sandbox?.webhookSecret).toBe('***');
  });

  test('valid keypair: registers the Unzer webhook (once per connected env) BEFORE the write', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 2 });

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
    // The webhook is registered before the CAS write (order: keypair → webhooks → write).
    const registerOrder = (provider.webhook.registerWebhooks as jest.Mock).mock.invocationCallOrder[0];
    const writeOrder = (ports.configStore.write as jest.Mock).mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(writeOrder);
    // eventUrl is the store's derived public webhook URL (from the resolved config).
    const [, eventUrl] = (provider.webhook.registerWebhooks as jest.Mock).mock.calls[0];
    expect(eventUrl).toBe(FAKE_WEBHOOK_URL);
  });

  test('invalid credentials: 4xx, NOTHING persisted, NO webhook registered', async () => {
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockResolvedValue({ success: false, message: 'the provider rejected the credentials' });

    await expect(
      updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toBeDefined();
    expect(provider.webhook.registerWebhooks).not.toHaveBeenCalled();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('a field-attributed rejection fails as a FIELD-LEVEL 400 naming that credential', async () => {
    provider.introspection.testConnection = jest.fn<typeof provider.introspection.testConnection>().mockResolvedValue({
      success: false,
      field: 'credentials.publicKey',
      message: 'The public key does not belong to the Unzer account this private key authenticates.',
    });

    const failure = await updateStoreConfig(
      { env, body: connectBody(creds()), storeKey: 'de-store' },
      { ports, provider },
    ).catch((e: Errorx) => e);

    expect((failure as Errorx).code).toBe('InvalidField');
    expect((failure as Errorx).httpErrorStatus).toBe(400);
    expect((failure as Errorx).fields).toMatchObject({ field: 'environments.sandbox.credentials.publicKey' });
    // The submitted key is never echoed into the error the merchant reads.
    expect(JSON.stringify(failure)).not.toContain('s-pub-key');
    expect(provider.webhook.registerWebhooks).not.toHaveBeenCalled();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('webhook registration fails: a 400 the merchant can read, and NOTHING persisted', async () => {
    provider.webhook.registerWebhooks = jest
      .fn<typeof provider.webhook.registerWebhooks>()
      .mockRejectedValue(new PspError('PSP API error: webhook already exists', 409));

    const failure = await updateStoreConfig(
      { env, body: connectBody(creds()), storeKey: 'de-store' },
      { ports, provider },
    ).catch((e: Errorx) => e);

    // Surfaced raw, a provider error is not an `Errorx`: the route answered 500 and serialized the
    // provider's own error object into the response. It is the merchant's problem to fix — so it reads
    // as a 400 carrying the provider's sanitized message, like a rejected keypair does.
    expect((failure as Errorx).httpErrorStatus).toBe(400);
    expect((failure as Errorx).message).toContain('webhook already exists');
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('CAS write fails after webhooks registered: best-effort deleteWebhooks rolls them back', async () => {
    ports.configStore.write = jest.fn<typeof ports.configStore.write>().mockRejectedValue(new Error('CAS conflict'));

    await expect(
      updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toBeDefined();

    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
    expect(provider.webhook.deleteWebhooks).toHaveBeenCalledTimes(1);
  });

  test('a failed webhook rollback does not mask the original write failure', async () => {
    ports.configStore.write = jest.fn<typeof ports.configStore.write>().mockRejectedValue(new Error('CAS conflict'));
    provider.webhook.deleteWebhooks = jest
      .fn<typeof provider.webhook.deleteWebhooks>()
      .mockRejectedValue(new PspError('PSP request failed', 502));

    await expect(
      updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toThrow(/CAS conflict/);
  });

  test('credential rotation on an already-connected env: deleteWebhooks runs BEFORE registerWebhooks', async () => {
    // The store is already connected in `sandbox`; the operator rotates the private key. The existing
    // subscription must be dropped before the new one is registered, so the rotation REPLACES it.
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });

    const body = connectBody(creds({ privateKey: 'rotated-priv-key' }));
    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(provider.webhook.deleteWebhooks).toHaveBeenCalledTimes(1);
    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
    const deleteOrder = (provider.webhook.deleteWebhooks as jest.Mock).mock.invocationCallOrder[0];
    const registerOrder = (provider.webhook.registerWebhooks as jest.Mock).mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(registerOrder);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);

    // And it authenticates with the OUTGOING key pair: a delete is scoped to the account that signs it,
    // so running it with the NEW pair would drop the new account's subscriptions and leave the old
    // account still calling us.
    const [deletedWith] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [StoreConfig];
    expect(deletedWith.credentials).toMatchObject(creds());
    const [registeredWith] = (provider.webhook.registerWebhooks as jest.Mock).mock.calls[0] as [StoreConfig];
    expect(registeredWith.credentials).toMatchObject(creds({ privateKey: 'rotated-priv-key' }));
  });

  // the ids a registration reports are SERVER-OWNED state on the environment block — the
  // merchant surfaces never send them — and they are what a later delete targets.
  test('persists the webhook ids the registration reported, on the connected environment', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });
    provider.webhook.registerWebhooks = jest
      .fn<typeof provider.webhook.registerWebhooks>()
      .mockResolvedValue(['wh-charge', 'wh-authorize']);

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    const [, written] = (ports.configStore.write as jest.Mock).mock.calls[0] as [string, StoredStoreConfig];
    expect(written.environments?.sandbox?.webhookIds).toEqual(['wh-charge', 'wh-authorize']);
  });

  test('keeps the OTHER environment ids the client never sends back', async () => {
    // The DTO does not admit `webhookIds`, so the body carries none. Without a carry-over the untouched
    // environment would lose them and its next disconnect would fall back to emptying the account.
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        live: { credentials: { publicKey: 'p-pub-x', privateKey: 'p-priv-x' }, webhookIds: ['wh-live'] },
      },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 5 });

    await updateStoreConfig(
      {
        env,
        body: { mode: 'sandbox', environments: { sandbox: { credentials: creds() }, live: {} } },
        storeKey: 'de-store',
      },
      { ports, provider },
    );

    const [, written] = (ports.configStore.write as jest.Mock).mock.calls[0] as [string, StoredStoreConfig];
    expect(written.environments?.live?.webhookIds).toEqual(['wh-live']);
  });

  test('a rotation deletes the OUTGOING account subscriptions BY ID and stores the new ones', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        sandbox: { credentials: creds(), webhookSecret: 'wh-secret', webhookIds: ['old-1', 'old-2'] },
      },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });
    provider.webhook.registerWebhooks = jest
      .fn<typeof provider.webhook.registerWebhooks>()
      .mockResolvedValue(['new-1']);

    await updateStoreConfig(
      { env, body: connectBody(creds({ privateKey: 'rotated-priv-key' })), storeKey: 'de-store' },
      { ports, provider },
    );

    const [, deletedIds] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [StoreConfig, string[]];
    expect(deletedIds).toEqual(['old-1', 'old-2']);
    const [, written] = (ports.configStore.write as jest.Mock).mock.calls[0] as [string, StoredStoreConfig];
    expect(written.environments?.sandbox?.webhookIds).toEqual(['new-1']);
  });

  test('a CAS failure rolls back exactly the subscriptions this call created', async () => {
    ports.configStore.write = jest.fn<typeof ports.configStore.write>().mockRejectedValue(new Error('CAS conflict'));
    provider.webhook.registerWebhooks = jest
      .fn<typeof provider.webhook.registerWebhooks>()
      .mockResolvedValue(['fresh-1']);

    await expect(
      updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toBeDefined();

    const [, rolledBack] = (provider.webhook.deleteWebhooks as jest.Mock).mock.calls[0] as [StoreConfig, string[]];
    expect(rolledBack).toEqual(['fresh-1']);
  });

  // "Connect succeeded → disconnect the previous account": a method list belongs to the account whose
  // keypair catalogue produced it, so a rotation onto a DIFFERENT account starts that environment's
  // methods empty rather than carrying settings chosen for money that now flows elsewhere.
  test('credential rotation clears the rotated environment payment-method config, after the write', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: {
          store: 'de-store',
          environments: {
            sandbox: { paymentMethods: [methodConfig('card')] },
            live: { paymentMethods: [methodConfig('paypal')] },
          },
        },
        version: 4,
      });

    await updateStoreConfig(
      { env, body: connectBody(creds({ privateKey: 'rotated-priv-key' })), storeKey: 'de-store' },
      { ports, provider },
    );

    const [storeKey, written, version] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
      string,
      { environments: Record<string, unknown> },
      number,
    ];
    expect(storeKey).toBe('de-store');
    expect(written.environments.sandbox).toBeUndefined();
    // The other environment is still on its own account — its configuration is not collateral.
    expect(written.environments.live).toBeDefined();
    expect(version).toBe(4);
    // Never before the connection itself is settled: the config write is the point of no return.
    const writeOrder = (ports.configStore.write as jest.Mock).mock.invocationCallOrder[0];
    const clearOrder = (ports.paymentMethodsStore.write as jest.Mock).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(clearOrder);
  });

  test('a rotation that empties the payment-methods object deletes it instead of leaving a husk', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        // Only the rotated environment was ever configured.
        value: { store: 'de-store', environments: { sandbox: { paymentMethods: [methodConfig('card')] } } },
        version: 4,
      });

    await updateStoreConfig(
      { env, body: connectBody(creds({ privateKey: 'rotated-priv-key' })), storeKey: 'de-store' },
      { ports, provider },
    );

    expect(ports.paymentMethodsStore.delete).toHaveBeenCalledWith('de-store', 4);
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('a FIRST connect leaves the payment-method config alone (there is no previous account)', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('a failed method-config clear does not fail the connect that already succeeded', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockRejectedValue(new Error('custom object unavailable'));

    await expect(
      updateStoreConfig(
        { env, body: connectBody(creds({ privateKey: 'rotated-priv-key' })), storeKey: 'de-store' },
        { ports, provider },
      ),
    ).resolves.toBeDefined();
  });

  test('a first connect (no prior credentials for that env) does NOT delete before registering', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 2 });

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(provider.webhook.deleteWebhooks).not.toHaveBeenCalled();
    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
  });

  test('a failed pre-rotation deleteWebhooks does not abort the re-connect', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 3 });
    provider.webhook.deleteWebhooks = jest
      .fn<typeof provider.webhook.deleteWebhooks>()
      .mockRejectedValue(new PspError('PSP request failed', 502));

    const body = connectBody(creds({ privateKey: 'rotated-priv-key' }));
    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('unedited masked (`***`) save: no re-probe, write still happens', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 5 });

    const maskedBody = connectBody(creds({ publicKey: '***', privateKey: '***' }));
    maskedBody.environments!.sandbox!.webhookSecret = '***';

    await updateStoreConfig({ env, body: maskedBody, storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).not.toHaveBeenCalled();
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('changing one real credential re-probes even when the rest stay masked', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { sandbox: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: undefined });

    const editBody = connectBody(creds({ publicKey: '***', privateKey: 'rotated-priv-key' }));
    await updateStoreConfig({ env, body: editBody, storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('changing the NON-active env credentials to invalid: 4xx and NOTHING persisted', async () => {
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockResolvedValue({ success: false, message: 'the provider rejected the credentials' });

    const body: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { live: { credentials: creds(), webhookSecret: 'wh-secret' } },
    };

    await expect(updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider })).rejects.toBeDefined();
    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('both envs changed and valid: both are probed (one config resolve), then write happens', async () => {
    const probedKeys: string[] = [];
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockImplementation(async (cfg) => {
        probedKeys.push(cfg.credentials.publicKey);
        return { success: true };
      });

    const body: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        sandbox: { credentials: creds({ publicKey: 'pub-test' }), webhookSecret: 'wh-secret' },
        live: { credentials: creds({ publicKey: 'pub-live' }), webhookSecret: 'wh-secret' },
      },
    };

    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(2);
    expect([...probedKeys].sort()).toEqual(['pub-live', 'pub-test']);
    expect(ports.configResolver.resolve).toHaveBeenCalledTimes(1);
    // Both connected environments get their webhook registered.
    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(2);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('only the active env changed (non-active unchanged masked): only the active is probed', async () => {
    const stored: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        sandbox: { credentials: creds({ publicKey: 'pub-test-old' }), webhookSecret: 'wh-secret' },
        live: { credentials: creds({ publicKey: 'pub-live' }), webhookSecret: 'wh-secret' },
      },
    };
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: stored, version: 1 });

    const probedKeys: string[] = [];
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockImplementation(async (cfg) => {
        probedKeys.push(cfg.credentials.publicKey);
        return { success: true };
      });

    const body: StoredStoreConfig = {
      mode: 'sandbox',
      environments: {
        sandbox: { credentials: creds({ publicKey: 'pub-test-new' }), webhookSecret: 'wh-secret' },
        live: { credentials: creds({ publicKey: '***', privateKey: '***' }), webhookSecret: '***' },
      },
    };

    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(probedKeys).toEqual(['pub-test-new']);
    expect(provider.webhook.registerWebhooks).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  // The project key is RESERVED and can never be the write target, so no Custom Object is ever written
  // under it — which is what keeps a no-store payment's later legs (resolve(projectKey)) from diverging
  // from its create leg (resolveDefault). A write must therefore NAME a real store: BOTH an explicit
  // `X-Store-Key == projectKey` and an absent header (which would fall back to it) are rejected.
  // `storeKey()` is the project key in the fake ports ('store-1').
  test('rejects an X-Store-Key equal to the project key and persists nothing (reserved key)', async () => {
    await expect(
      updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'store-1' }, { ports, provider }),
    ).rejects.toThrow(/reserved/i);
    expect(provider.introspection.testConnection).not.toHaveBeenCalled();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('the DEFAULT SCOPE is a legal write target — it is not the reserved project key', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });

    await updateStoreConfig(
      { env, body: connectBody(creds()), storeKey: DEFAULT_SCOPE_STORE_KEY },
      { ports, provider },
    );

    // Configuring the layer every unconnected store follows goes through the ordinary write path:
    // probe → webhook → CAS write, all under the same manage-permission gate.
    expect(provider.introspection.testConnection).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledWith(DEFAULT_SCOPE_STORE_KEY, expect.anything(), undefined);
  });

  test('an absent X-Store-Key (which would fall back to the reserved project key) is rejected, nothing persisted', async () => {
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockResolvedValue({ success: true });

    await expect(updateStoreConfig({ env, body: connectBody(creds()) }, { ports, provider })).rejects.toThrow(
      /reserved|X-Store-Key/i,
    );

    expect(provider.introspection.testConnection).not.toHaveBeenCalled();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('the 4xx message never echoes a submitted secret', async () => {
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockResolvedValue({ success: false, message: 'authentication failed' });

    const secret = 'super-secret-do-not-leak';
    await expect(
      updateStoreConfig(
        { env, body: connectBody(creds({ privateKey: secret })), storeKey: 'de-store' },
        { ports, provider },
      ),
    ).rejects.toThrow(expect.not.stringContaining(secret) as never);
  });
});

/**
 * Integration: the REAL `PspIntrospectionService` drives the connect gate against a FAKE `PspClient`,
 * proving the request-body overlay reaches the real keypair probe and — critically — that the
 * per-environment `mode` (which selects the sandbox-vs-live Unzer host) is the one carried to the
 * client. A rejected keypair surfaces as a secret-free 4xx and gates persistence.
 */
describe('updateStoreConfig — connect gate (real PspIntrospectionService + fake PspClient)', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  /** A fake `PspClient` capturing every probed `mode`; `reject` fails the keypair for a given mode. */
  function fakeUnzer(reject?: { mode: PspConnectionConfig['mode']; privateKeyEcho: string }) {
    const probedModes: PspConnectionConfig['mode'][] = [];
    const client = {
      keypair: {
        validate: jest.fn(async (cfg: PspConnectionConfig) => {
          probedModes.push(cfg.mode);
          if (reject && cfg.mode === reject.mode) {
            // A real PspError from a 401 keypair — its message never carries the private key.
            throw new PspError('PSP API error: Access denied', 401);
          }
          return { availableMethods: [], methodSupport: [] };
        }),
      },
      payments: {} as PspClient['payments'],
    } as unknown as Pick<PspClient, 'keypair' | 'payments'> & {
      keypair: { validate: jest.Mock<(cfg: PspConnectionConfig) => Promise<KeypairResult>> };
    };
    return { client, probedModes };
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    const realConfig = new PspConfigHandler();
    provider.config.reconcileSecrets = (incoming, previous) => realConfig.reconcileSecrets(incoming, previous);
    // The overlay's base config comes from `makeFakePorts`' resolver (empty credentials), so the
    // credentials the gate probes with are exactly the request-body overlay.
  });

  test('a valid keypair lets the save through to write', async () => {
    const { client } = fakeUnzer();
    provider.introspection = new PspIntrospectionService(client);

    await updateStoreConfig({ env, body: connectBody(creds()), storeKey: 'de-store' }, { ports, provider });

    expect(client.keypair.validate).toHaveBeenCalledTimes(1);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });

  test('a rejected keypair blocks the save with a secret-free 4xx', async () => {
    const secret = 's-priv-live-only-xyz';
    const { client } = fakeUnzer({ mode: 'sandbox', privateKeyEcho: secret });
    provider.introspection = new PspIntrospectionService(client);

    await expect(
      updateStoreConfig(
        { env, body: connectBody(creds({ privateKey: secret })), storeKey: 'de-store' },
        { ports, provider },
      ),
    ).rejects.toThrow(expect.not.stringContaining(secret) as never);
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  // The correctness the whole `mode` seam exists for: probing a NON-active environment (live) while the
  // store's active mode is sandbox must reach the client with `mode: 'live'` — otherwise the keypair
  // would be validated against the wrong Unzer host.
  test('a non-active (live) env is probed against the LIVE host: mode "live" reaches the client', async () => {
    const { client, probedModes } = fakeUnzer();
    provider.introspection = new PspIntrospectionService(client);

    const body: StoredStoreConfig = {
      mode: 'sandbox',
      environments: { live: { credentials: creds({ privateKey: 'p-priv-live' }), webhookSecret: 'wh-secret' } },
    };

    await updateStoreConfig({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(probedModes).toEqual(['live']);
    expect(ports.configStore.write).toHaveBeenCalledTimes(1);
  });
});
