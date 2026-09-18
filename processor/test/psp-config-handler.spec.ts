import { describe, expect, it } from '@jest/globals';
import { storeConfig } from './support/store-config';
import { PspConfigHandler } from '../src/providers/psp/config/config.handler';
import type { StoredStoreConfig } from '../src/domain';

const handler = new PspConfigHandler();

describe('PspConfigHandler — validate (strict empty-object schema)', () => {
  it('validate returns { valid:true } for an empty settings document', () => {
    expect(handler.validate({})).toEqual({ valid: true });
  });

  it('validate returns { valid:true } for an absent settings value', () => {
    expect(handler.validate(undefined)).toEqual({ valid: true });
  });

  it('strict-rejects a retired flows document — every field is an unknown property', () => {
    const result = handler.validate({ flows: { embedded: { enabled: true } } });
    expect(result.valid).toBe(false);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  it('strict-rejects a retired combos list (additionalProperties:false)', () => {
    const result = handler.validate({ combos: [] });
    expect(result.valid).toBe(false);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });
});

describe('PspConfigHandler — shopperPublicKey (the only shopper-safe credential)', () => {
  it('returns the environment public key off the opaque credentials bag', () => {
    const cfg = storeConfig({ credentials: { publicKey: 'pub-key', privateKey: 'priv-secret' } });
    expect(handler.shopperPublicKey(cfg)).toBe('pub-key');
  });

  it('returns the empty string when the environment carries no public key', () => {
    const cfg = storeConfig({ credentials: { privateKey: 'priv-secret' } });
    expect(handler.shopperPublicKey(cfg)).toBe('');
  });

  it('never surfaces the private key — the public key is the whole return', () => {
    const cfg = storeConfig({ credentials: { publicKey: 'pub-key', privateKey: 'priv-NEVER-LEAK' } });
    expect(handler.shopperPublicKey(cfg)).not.toContain('priv-NEVER-LEAK');
  });
});

describe('PspConfigHandler — missingConnectionFields (mandatory Unzer key pair)', () => {
  it('reports no missing fields when the block carries publicKey + privateKey', () => {
    expect(handler.missingConnectionFields({ credentials: { publicKey: 'pub', privateKey: 'priv' } })).toEqual([]);
  });

  it('flags a missing publicKey credential', () => {
    expect(handler.missingConnectionFields({ credentials: { privateKey: 'priv' } })).toEqual(['credentials.publicKey']);
  });

  it('flags a missing privateKey credential', () => {
    expect(handler.missingConnectionFields({ credentials: { publicKey: 'pub' } })).toEqual(['credentials.privateKey']);
  });

  it('flags both when neither is present', () => {
    expect(handler.missingConnectionFields({ credentials: {} })).toEqual([
      'credentials.publicKey',
      'credentials.privateKey',
    ]);
  });
});

describe('PspConfigHandler — secret topology + redaction + reconciliation', () => {
  const stored = (): StoredStoreConfig => ({
    mode: 'sandbox',
    environments: {
      sandbox: {
        credentials: { publicKey: 'pub', privateKey: 'priv' },
        host: 'h',
        webhookUrl: 'u',
      },
    },
    settings: undefined,
  });

  it('redact returns the credentials IN THE CLEAR and masks only webhookSecret', () => {
    const redacted = handler.redact({
      ...stored(),
      environments: {
        sandbox: {
          credentials: { publicKey: 'pub', privateKey: 'priv' },
          webhookSecret: 'wh-secret',
          host: 'h',
          webhookUrl: 'u',
        },
      },
    });
    // The connection screen exists to show WHICH key pair the store holds - the response is served only
    // behind the JWT + manage gate, and both keys stay encrypted at rest.
    expect(redacted.environments?.sandbox?.credentials).toEqual({ publicKey: 'pub', privateKey: 'priv' });
    expect(redacted.environments?.sandbox?.webhookSecret).toBe('***');
    expect(redacted.environments?.sandbox?.host).toBe('h');
    expect(redacted.environments?.sandbox?.webhookUrl).toBe('u');
  });

  it('reconcileSecrets substitutes the previous value for a re-sent mask and keeps a changed secret', () => {
    const incoming: StoredStoreConfig = {
      environments: { sandbox: { credentials: { publicKey: 'pub-new', privateKey: '***' } } },
    };
    const reconciled = handler.reconcileSecrets(incoming, stored());
    // publicKey was changed → kept; privateKey was masked → substituted from previous.
    expect(reconciled.environments?.sandbox?.credentials).toEqual({ publicKey: 'pub-new', privateKey: 'priv' });
  });

  it('credentials stay secret AT REST: a re-sent mask is substituted on write even though reads are clear', () => {
    const withPair: StoredStoreConfig = {
      environments: {
        sandbox: { credentials: { publicKey: 'pub', privateKey: 'live-priv' } },
      },
    };

    // Read projection is CLEAR: redact leaves the pair readable for the connection screen.
    expect(handler.redact(withPair).environments?.sandbox?.credentials?.privateKey).toBe('live-priv');

    const reconciled = handler.reconcileSecrets(
      { environments: { sandbox: { credentials: { publicKey: 'pub', privateKey: '***' } } } },
      withPair,
    );
    expect(reconciled.environments?.sandbox?.credentials?.privateKey).toBe('live-priv');
  });

  it('reconcileSecrets drops a masked leaf that has no previous value (the mask is never persisted)', () => {
    const incoming: StoredStoreConfig = {
      environments: { sandbox: { credentials: { privateKey: '***' } } },
    };
    const reconciled = handler.reconcileSecrets(incoming, null);
    expect(reconciled.environments?.sandbox?.credentials).toEqual({});
  });

  it('redact leaves the opaque (empty) settings document untouched', () => {
    const withSettings: StoredStoreConfig = { ...stored(), settings: {} };

    const redacted = handler.redact(withSettings);

    // The credentials ride through in the clear...
    expect(redacted.environments?.sandbox?.credentials).toEqual({ publicKey: 'pub', privateKey: 'priv' });
    // ...and the opaque settings document rides through the response verbatim.
    expect(redacted.settings).toEqual({});
  });

  it('reconcileSecrets preserves the opaque settings document while substituting a re-sent secret mask', () => {
    const incoming: StoredStoreConfig = {
      environments: { sandbox: { credentials: { publicKey: 'pub', privateKey: '***' } } },
      settings: {},
    };

    const reconciled = handler.reconcileSecrets(incoming, stored());

    // Secrets reconcile as usual (the re-sent masks resolve back to the previously-stored values)...
    expect(reconciled.environments?.sandbox?.credentials).toEqual({ publicKey: 'pub', privateKey: 'priv' });
    // ...while the opaque settings document passes through untouched.
    expect(reconciled.settings).toEqual({});
  });
});
