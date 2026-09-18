/**
 * Shared scaffolding for the suites that exercise the webhook capability-URL token: the independent
 * formula ORACLE and the keyring env pinning both of them need.
 *
 * The oracle is a deliberate hand-written replica of the spec's FIXED formula rather than a
 * call into `config/crypto` — a suite must fail if the production derivation drifts from the spec,
 * not agree with it by construction. It stays here so the two suites that assert a minted URL derive
 * the expectation from ONE replica.
 */
import { afterAll, beforeEach } from '@jest/globals';
import { createHmac } from 'crypto';

/**
 * The token the given key derives for a store:
 * `base64url(HMAC-SHA256(key material, "psp-webhook-url-token:v1:" + storeKey))`, 43 chars, no
 * padding. `hexKey` must be a 64-hex-char value — the processor uses such a value VERBATIM as the 32
 * raw key bytes, so the oracle needs no access to the module's private key parsing.
 */
export function expectedWebhookToken(hexKey: string, storeKey: string): string {
  return createHmac('sha256', Buffer.from(hexKey, 'hex'))
    .update(`psp-webhook-url-token:v1:${storeKey}`)
    .digest('base64url');
}

/**
 * Pin the keyring a suite derives tokens from: `ENCRYPTION_KEY` = `currentKey` and NO previous key
 * before every test (a test that needs a rotation window sets `ENCRYPTION_KEY_PREVIOUS` itself), and
 * the ambient values restored once the suite finishes so no key leaks into the next suite in the
 * worker. Call it at the top of the file or inside the describe that needs the keyring.
 */
export function useEncryptionKeyring(currentKey: string): void {
  const savedCurrent = process.env.ENCRYPTION_KEY;
  const savedPrevious = process.env.ENCRYPTION_KEY_PREVIOUS;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = currentKey;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });

  afterAll(() => {
    if (savedCurrent === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedCurrent;
    if (savedPrevious === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = savedPrevious;
  });
}
