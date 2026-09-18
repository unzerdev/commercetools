/**
 * `StoreConfigRequestSchema` boundary (Sec1): the per-environment block accepts only `credentials`
 * and `webhookSecret`. `host` and `webhookUrl` are NOT client-writable — the vendor host is derived
 * from the active `mode` and the webhook URL is derived by the connector, so both are
 * server-authoritative. With `additionalProperties: false`, a hand-crafted PUT carrying either is
 * rejected at the schema gate and never reaches persistence — so it can never redirect the registered
 * Unzer webhook or the vendor host.
 */
import { describe, expect, it } from '@jest/globals';
import { Value } from '@sinclair/typebox/value';
import { StoreConfigRequestSchema } from '../src/infrastructure/http/dtos/mc/store-config.dto';

const credentials = { publicKey: 's-pub-key', privateKey: 's-priv-key' };

describe('StoreConfigRequestSchema — host/webhookUrl are not client-writable', () => {
  it('accepts a connect body with credentials + webhookSecret', () => {
    const body = { mode: 'sandbox', environments: { sandbox: { credentials, webhookSecret: 'wh' } } };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(true);
  });

  it('rejects a body injecting environments.sandbox.webhookUrl (would redirect the webhook)', () => {
    const body = {
      mode: 'sandbox',
      environments: { sandbox: { credentials, webhookUrl: 'https://attacker.example/hook' } },
    };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(false);
  });

  it('rejects a body injecting environments.sandbox.host (would redirect the vendor host)', () => {
    const body = {
      mode: 'sandbox',
      environments: { sandbox: { credentials, host: 'https://attacker.example' } },
    };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(false);
  });

  it('rejects an unknown per-environment key (only sandbox/live exist)', () => {
    const body = {
      mode: 'sandbox',
      environments: { sandbox: { credentials }, production: { credentials } },
    };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(false);
  });
});

/**
 * The admin-writable secret strings are bounded at this gate (Sec, S1): an unbounded credential value
 * or key count is a cheap memory-pressure / persistence-bloat vector on a manage write.
 */
describe('StoreConfigRequestSchema — secret strings are size-bounded', () => {
  it('rejects an over-length credential value', () => {
    const body = { environments: { sandbox: { credentials: { privateKey: 'x'.repeat(513) } } } };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(false);
  });

  it('rejects a credentials record carrying too many keys', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 17; i += 1) {
      many[`k${i}`] = 'v';
    }
    const body = { environments: { sandbox: { credentials: many } } };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(false);
  });

  it('accepts a credential value at the bound', () => {
    const body = { environments: { sandbox: { credentials: { privateKey: 'x'.repeat(512) } } } };
    expect(Value.Check(StoreConfigRequestSchema, body)).toBe(true);
  });
});
