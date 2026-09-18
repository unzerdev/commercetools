import { describe, expect, it } from '@jest/globals';
import { validatePspConfig } from '../src/providers/psp/config/store-settings.schema';

/**
 * The provider-owned `PspConfig` is EMPTY: this connector has no settings document (payment behavior
 * lives in the PaymentMethodConfig Custom Object, 3-D Secure is delegated to the Unzer element). The
 * strict empty-object schema is the guard that keeps the opaque `settings` bag empty — an absent or
 * `{}` value is valid, any field is rejected.
 */
describe('PspConfig strict empty-object validation', () => {
  it('accepts an absent settings value (this connector carries no settings document)', () => {
    expect(validatePspConfig(undefined).valid).toBe(true);
    expect(validatePspConfig(null).valid).toBe(true);
  });

  it('accepts an empty settings object', () => {
    const result = validatePspConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects a retired `flows` document as an unknown field', () => {
    const result = validatePspConfig({ flows: { embedded: { enabled: true } } });
    expect(result.valid).toBe(false);
    expect(result.errors && result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a retired `combos` list — the country+currency machinery is gone', () => {
    expect(validatePspConfig({ combos: [] }).valid).toBe(false);
  });

  it('rejects a `general` block — the flat behavior block is gone', () => {
    expect(validatePspConfig({ general: { merchantReference: 'ref' } }).valid).toBe(false);
  });

  it('rejects an envelope-level field (mode) misfiled into settings', () => {
    expect(validatePspConfig({ mode: 'sandbox' }).valid).toBe(false);
  });

  it('rejects a secret leaf smuggled into the settings bag', () => {
    expect(validatePspConfig({ privateKey: 'leak' }).valid).toBe(false);
  });
});
