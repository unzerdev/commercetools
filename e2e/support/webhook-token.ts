import { createHash, createHmac } from 'node:crypto';

/**
 * Webhook capability-URL token derivation for the e2e harness — a dependency-free (node:crypto only)
 * replica of the processor's formula (`processor/src/infrastructure/config/crypto.ts`):
 *
 *   token = base64url( HMAC-SHA256( keyMaterialFrom(ENCRYPTION_KEY),
 *                                   "psp-webhook-url-token:v1:" + storeKey ) )
 *
 * — 43 base64url characters, no padding, deterministic. `keyMaterialFrom` mirrors the processor's key
 * parsing exactly: a 64-hex-char value is used VERBATIM as the 32 raw key bytes, anything else is
 * SHA-256'd down to 32 bytes. The domain-separation prefix keeps the MAC use disjoint from the same
 * key's AES-GCM use. Nothing is persisted anywhere — the token re-derives from the key at any time.
 */

/** The processor's domain-separation prefix — MUST match `WEBHOOK_TOKEN_INFO` in the processor. */
const WEBHOOK_TOKEN_INFO = 'psp-webhook-url-token:v1:';

/** Parse a raw env value into 32 key bytes: 64-hex verbatim, else SHA-256-derived (processor parity). */
function keyMaterialFrom(raw: string): Buffer {
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw).digest();
}

/** The capability-URL token the processor's CURRENT key derives for `storeKey`. */
export function webhookUrlToken(encryptionKey: string, storeKey: string): string {
  return createHmac('sha256', keyMaterialFrom(encryptionKey))
    .update(WEBHOOK_TOKEN_INFO + storeKey, 'utf8')
    .digest('base64url');
}
