import { describe, expect, it } from '@jest/globals';
import { verifyWebhookUrlToken, webhookUrlToken } from '../src/infrastructure/crypto/crypto';
import { expectedWebhookToken as expectedToken, useEncryptionKeyring } from './support/webhook-token';

// A 64-hex-char key is used verbatim as the 32 raw key bytes — so the shared oracle can derive the
// key material without reaching into the module's private helpers.
const KEY_CURRENT = 'a'.repeat(64);
const KEY_PREVIOUS = 'b'.repeat(64);

const STORE_KEY = 'store-eu';
const OTHER_STORE_KEY = 'store-us';

describe('config/crypto webhook capability-URL token (HMAC-SHA256, base64url)', () => {
  useEncryptionKeyring(KEY_CURRENT);

  describe('webhookUrlToken (mint)', () => {
    it('derives the exact HMAC-SHA256 base64url token from the CURRENT key', () => {
      expect(webhookUrlToken(STORE_KEY)).toBe(expectedToken(KEY_CURRENT, STORE_KEY));
    });

    it('is deterministic and URL-safe: 43 base64url chars, no padding', () => {
      const token = webhookUrlToken(STORE_KEY);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(webhookUrlToken(STORE_KEY)).toBe(token); // same key + storeKey → same token
    });

    it('gives different stores different tokens', () => {
      expect(webhookUrlToken(STORE_KEY)).not.toBe(webhookUrlToken(OTHER_STORE_KEY));
    });

    it('throws when ENCRYPTION_KEY is unset or whitespace-only (same rule as encrypt)', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => webhookUrlToken(STORE_KEY)).toThrow(/ENCRYPTION_KEY/);

      process.env.ENCRYPTION_KEY = '   ';
      expect(() => webhookUrlToken(STORE_KEY)).toThrow(/ENCRYPTION_KEY/);
    });
  });

  describe('verifyWebhookUrlToken (fail-closed, total)', () => {
    it('accepts the current-key token', () => {
      expect(verifyWebhookUrlToken(STORE_KEY, webhookUrlToken(STORE_KEY))).toBe(true);
    });

    it('accepts the PREVIOUS-key token during rotation', () => {
      // A URL registered under the old key keeps delivering after the key is promoted.
      const oldToken = expectedToken(KEY_PREVIOUS, STORE_KEY);
      process.env.ENCRYPTION_KEY_PREVIOUS = KEY_PREVIOUS;
      expect(verifyWebhookUrlToken(STORE_KEY, oldToken)).toBe(true);
    });

    it('rejects a previous-key token once the rotation window is closed', () => {
      // No ENCRYPTION_KEY_PREVIOUS configured → only current-key derivations verify.
      expect(verifyWebhookUrlToken(STORE_KEY, expectedToken(KEY_PREVIOUS, STORE_KEY))).toBe(false);
    });

    it("rejects another store's token (wrong token, correct length)", () => {
      expect(verifyWebhookUrlToken(STORE_KEY, webhookUrlToken(OTHER_STORE_KEY))).toBe(false);
    });

    it('rejects a wrong-length candidate without throwing (timingSafeEqual length guard)', () => {
      expect(verifyWebhookUrlToken(STORE_KEY, webhookUrlToken(STORE_KEY).slice(0, -1))).toBe(false);
      expect(verifyWebhookUrlToken(STORE_KEY, `${webhookUrlToken(STORE_KEY)}x`)).toBe(false);
    });

    it('rejects an empty or undefined-ish candidate', () => {
      expect(verifyWebhookUrlToken(STORE_KEY, '')).toBe(false);
      expect(verifyWebhookUrlToken(STORE_KEY, undefined as unknown as string)).toBe(false);
    });

    it('returns false — never throws — when ENCRYPTION_KEY is unset', () => {
      const token = webhookUrlToken(STORE_KEY);
      delete process.env.ENCRYPTION_KEY;
      expect(verifyWebhookUrlToken(STORE_KEY, token)).toBe(false);
    });
  });
});
