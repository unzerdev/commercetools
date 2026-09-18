import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { assertEncryptionKeyStrength } from '../src/infrastructure/crypto/encryption-key-guard';

const HEX_64_KEY = 'a'.repeat(64);
const OTHER_64_KEY = 'b'.repeat(64);

/**
 * Strength half of the guard: the webhook capability-URL token is the first PUBLICLY circulating
 * derivative of ENCRYPTION_KEY (`keyMaterialFrom` accepts any string), so a template placeholder or a
 * short passphrase left in production makes every derived token guessable. The guard refuses boot for
 * a configured-but-weak key — the exact template placeholder, or anything under 32 characters — and
 * applies the same rule to ENCRYPTION_KEY_PREVIOUS: a weak previous key is an open door of its own.
 */
describe('config/encryption-key-guard — configured keys must be strong', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalPrevious = process.env.ENCRYPTION_KEY_PREVIOUS;

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
    if (originalPrevious === undefined) {
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    } else {
      process.env.ENCRYPTION_KEY_PREVIOUS = originalPrevious;
    }
  });

  it('is a no-op when neither key is configured; a missing key is the required guard concern', () => {
    expect(() => assertEncryptionKeyStrength()).not.toThrow();
  });

  it('refuses to boot on the exact template placeholder (32 chars by construction, still never a key)', () => {
    process.env.ENCRYPTION_KEY = 'replace-with-openssl-rand-hex-32';
    expect(() => assertEncryptionKeyStrength()).toThrow(/openssl rand -hex 32/);
  });

  it('refuses to boot on a short passphrase and names the fix without echoing the value', () => {
    process.env.ENCRYPTION_KEY = 'hunter2-super-secret';
    try {
      assertEncryptionKeyStrength();
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).toContain('openssl rand -hex 32');
      expect((error as Error).message).not.toContain('hunter2-super-secret');
    }
  });

  it('refuses to boot on a whitespace-padded template placeholder', () => {
    // A trailing space survives docker-compose `environment:` entries and Connect variable values, and
    // the padded placeholder clears the length rule (32 chars once trimmed). Both halves of the rule
    // must therefore see the same trimmed value, or the published template value is a usable key.
    process.env.ENCRYPTION_KEY = 'replace-with-openssl-rand-hex-32 ';
    expect(() => assertEncryptionKeyStrength()).toThrow(/openssl rand -hex 32/);
  });

  it('refuses to boot on the bracketed placeholder the env templates now ship', () => {
    process.env.ENCRYPTION_KEY = '<openssl rand -hex 32>';
    expect(() => assertEncryptionKeyStrength()).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses to boot on a weak ENCRYPTION_KEY_PREVIOUS even when the current key is strong', () => {
    process.env.ENCRYPTION_KEY = HEX_64_KEY;
    process.env.ENCRYPTION_KEY_PREVIOUS = 'replace-with-openssl-rand-hex-32';
    expect(() => assertEncryptionKeyStrength()).toThrow(/ENCRYPTION_KEY_PREVIOUS/);
  });

  it('a whitespace-padded short value does not sneak past the length rule', () => {
    process.env.ENCRYPTION_KEY = `   short-key   ${' '.repeat(20)}`;
    expect(() => assertEncryptionKeyStrength()).toThrow(/ENCRYPTION_KEY/);
  });

  it('boots on a 64-hex key and on a >=32-char passphrase, alone or as the previous key', () => {
    process.env.ENCRYPTION_KEY = HEX_64_KEY;
    expect(() => assertEncryptionKeyStrength()).not.toThrow();

    process.env.ENCRYPTION_KEY = 'a-genuinely-long-operator-chosen-passphrase';
    process.env.ENCRYPTION_KEY_PREVIOUS = OTHER_64_KEY;
    expect(() => assertEncryptionKeyStrength()).not.toThrow();
  });
});
