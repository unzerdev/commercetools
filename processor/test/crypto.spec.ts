import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { currentKeyId, decrypt, encrypt, isEncrypted, keyIdOf } from '../src/infrastructure/crypto/crypto';

// A 64-hex-char key is used verbatim as the 32 raw key bytes; anything else is SHA-256'd to 32 bytes.
const KEY_CURRENT = 'a'.repeat(64);
const KEY_PREVIOUS = 'b'.repeat(64);
const PASSPHRASE_KEY = 'correct horse battery staple';

// The v1 envelope: `v1:<key-id>:<iv>:<tag>:<ciphertext>`, every part lowercase hex.
// key-id = 12 hex chars (6-byte fingerprint); iv = 32 hex (16 bytes); tag = 32 hex (16 bytes).
const V1_REGEX = /^v1:[0-9a-f]{12}:[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;

describe('config/crypto (AES-256-GCM, v1:key-id:iv:tag:ciphertext hex)', () => {
  let savedCurrent: string | undefined;
  let savedPrevious: string | undefined;

  beforeEach(() => {
    savedCurrent = process.env.ENCRYPTION_KEY;
    savedPrevious = process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });

  afterEach(() => {
    if (savedCurrent === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedCurrent;
    if (savedPrevious === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = savedPrevious;
  });

  describe('with a 64-hex ENCRYPTION_KEY (raw key bytes)', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
    });

    it('round-trips encrypt → decrypt back to the original plaintext', () => {
      const plaintext = 'super-secret-api-key';
      const encrypted = encrypt(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('produces a different ciphertext on each call (random IV)', () => {
      const plaintext = 'same-input';
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);

      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });

    it('emits the five-part v1 envelope carrying the current key-id', () => {
      const encrypted = encrypt('value');

      expect(encrypted).toMatch(V1_REGEX);
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe('v1');
      expect(parts[1]).toBe(currentKeyId());
      expect(keyIdOf(encrypted)).toBe(currentKeyId());
    });

    it('passes an empty string through unchanged', () => {
      expect(encrypt('')).toBe('');
    });
  });

  describe('with a passphrase ENCRYPTION_KEY (SHA-256 → 32 bytes)', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = PASSPHRASE_KEY;
    });

    it('round-trips encrypt → decrypt back to the original plaintext', () => {
      const plaintext = 'another-secret';
      const encrypted = encrypt(plaintext);

      expect(encrypted).toMatch(V1_REGEX);
      expect(encrypted).not.toBe(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });
  });

  describe('keyring rotation (current + previous)', () => {
    it('decrypts a value written under the previous key via the fallback', () => {
      // Encrypt while KEY_PREVIOUS is the only (current) key.
      process.env.ENCRYPTION_KEY = KEY_PREVIOUS;
      const plaintext = 'rotated-secret';
      const encryptedUnderOld = encrypt(plaintext);

      // Rotate: KEY_CURRENT becomes current, the old key moves to previous.
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
      process.env.ENCRYPTION_KEY_PREVIOUS = KEY_PREVIOUS;

      // The stored envelope still carries the old key-id; decrypt selects it via fallback.
      expect(keyIdOf(encryptedUnderOld)).not.toBe(currentKeyId());
      expect(decrypt(encryptedUnderOld)).toBe(plaintext);
    });

    it('gives current and previous distinct, deterministic key-ids', () => {
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
      const idA = currentKeyId();
      process.env.ENCRYPTION_KEY = KEY_PREVIOUS;
      const idB = currentKeyId();

      expect(idA).toMatch(/^[0-9a-f]{12}$/);
      expect(idB).toMatch(/^[0-9a-f]{12}$/);
      expect(idA).not.toBe(idB);

      process.env.ENCRYPTION_KEY = KEY_CURRENT;
      expect(currentKeyId()).toBe(idA); // deterministic per key
    });
  });

  describe('currentKeyId', () => {
    it('throws when ENCRYPTION_KEY is unset (same as the encrypt path)', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => currentKeyId()).toThrow(/ENCRYPTION_KEY/);
    });

    it('treats a whitespace-only ENCRYPTION_KEY as ABSENT — throws rather than deriving a key', () => {
      process.env.ENCRYPTION_KEY = '   ';
      expect(() => currentKeyId()).toThrow(/ENCRYPTION_KEY/);
      expect(() => encrypt('value')).toThrow(/ENCRYPTION_KEY/);
    });
  });

  describe('whitespace-only ENCRYPTION_KEY_PREVIOUS', () => {
    it('is treated as ABSENT: a value under an unresolved key-id fails closed, not via a blank fallback', () => {
      // Encrypt under KEY_PREVIOUS, then configure KEY_CURRENT with a whitespace-only "previous".
      process.env.ENCRYPTION_KEY = KEY_PREVIOUS;
      const encrypted = encrypt('secret-under-old-key');

      process.env.ENCRYPTION_KEY = KEY_CURRENT;
      process.env.ENCRYPTION_KEY_PREVIOUS = '   ';

      // The blank previous key contributes no fallback, so the old-key envelope is undecryptable.
      expect(() => decrypt(encrypted)).toThrow();
    });
  });

  describe('isEncrypted', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
    });

    it('is true for encrypt() output', () => {
      expect(isEncrypted(encrypt('x'))).toBe(true);
    });

    it('is false for a plaintext value', () => {
      expect(isEncrypted('just-a-plain-string')).toBe(false);
    });

    it('is false for the legacy v0 three-part shape (no v1 prefix)', () => {
      const v0 = `${'a'.repeat(32)}:${'b'.repeat(32)}:${'cc'}`;
      expect(isEncrypted(v0)).toBe(false);
    });

    it('is false for malformed v1 values (empty, wrong part count, non-hex, bad lengths)', () => {
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('v1:only:three:parts')).toBe(false); // 4 parts
      expect(isEncrypted(`v1:${'a'.repeat(12)}:${'b'.repeat(32)}:${'c'.repeat(32)}`)).toBe(false); // missing ciphertext
      expect(isEncrypted(`v2:${'a'.repeat(12)}:${'b'.repeat(32)}:${'c'.repeat(32)}:dd`)).toBe(false); // wrong version
      // Right shape, but a non-hex IV must be rejected.
      expect(isEncrypted(`v1:${'a'.repeat(12)}:${'g'.repeat(32)}:${'c'.repeat(32)}:dd`)).toBe(false);
      // IV wrong length.
      expect(isEncrypted(`v1:${'a'.repeat(12)}:${'b'.repeat(30)}:${'c'.repeat(32)}:dd`)).toBe(false);
      // Empty ciphertext.
      expect(isEncrypted(`v1:${'a'.repeat(12)}:${'b'.repeat(32)}:${'c'.repeat(32)}:`)).toBe(false);
    });
  });

  describe('keyIdOf', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
    });

    it('returns the envelope key-id for a v1 value', () => {
      const encrypted = encrypt('secret');
      expect(keyIdOf(encrypted)).toBe(currentKeyId());
    });

    it('returns undefined for a plaintext / non-v1 value', () => {
      expect(keyIdOf('plaintext')).toBeUndefined();
      expect(keyIdOf('')).toBeUndefined();
      expect(keyIdOf(`${'a'.repeat(32)}:${'b'.repeat(32)}:cc`)).toBeUndefined(); // v0 shape
    });
  });

  describe('decrypt fail-closed (throws on a genuine decryption failure)', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = KEY_CURRENT;
    });

    it('returns a non-encrypted string unchanged (partial-migration / plaintext pass-through)', () => {
      expect(decrypt('not-encrypted')).toBe('not-encrypted');
    });

    it('returns a malformed value unchanged (not recognised as ciphertext)', () => {
      expect(decrypt('v1:zz:zz:zz')).toBe('v1:zz:zz:zz');
    });

    it('THROWS (no secret in message) when the stored key-id matches no configured key', () => {
      // Encrypt under KEY_PREVIOUS, then configure only KEY_CURRENT (no previous) → key-id unresolvable.
      process.env.ENCRYPTION_KEY = KEY_PREVIOUS;
      const plaintext = 'PLAINTEXT-XYZ';
      const encrypted = encrypt(plaintext);

      process.env.ENCRYPTION_KEY = KEY_CURRENT;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;

      expect(() => decrypt(encrypted)).toThrow();
      try {
        decrypt(encrypted);
        throw new Error('decrypt did not throw');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        expect(message).not.toContain(encrypted);
        expect(message).not.toContain(plaintext);
      }
    });

    it('THROWS when the ciphertext has been tampered with (bad GCM auth tag)', () => {
      const plaintext = 'PLAINTEXT-TAMPER';
      const encrypted = encrypt(plaintext);
      const [v, id, iv, tag, ciphertext] = encrypted.split(':');
      // Flip the last hex nibble of the ciphertext → GCM auth-tag verification fails.
      const flipped = ciphertext.slice(0, -1) + (ciphertext.slice(-1) === '0' ? '1' : '0');
      const tampered = `${v}:${id}:${iv}:${tag}:${flipped}`;

      expect(() => decrypt(tampered)).toThrow(/decrypt/i);
      try {
        decrypt(tampered);
        throw new Error('decrypt did not throw');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        expect(message).not.toContain(plaintext);
      }
    });
  });
});
