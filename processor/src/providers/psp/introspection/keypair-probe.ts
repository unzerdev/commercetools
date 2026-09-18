import type { ConnectionTestResult, StoreConfig } from '../../../domain';
import { type KeypairResult, type PspClient, toPspConnectionConfig } from '../client';
import { PspError } from '../errors';

/** The connection field a keypair mismatch is attributed to. */
export const PUBLIC_KEY_FIELD = 'credentials.publicKey';

/**
 * The reason the configured pair is not one keypair, or `undefined` when it is or cannot be checked. A 2xx
 * proves only the private key; the response's own public key proves the pair. Neither key is echoed.
 */
export function keypairMismatch(cfg: StoreConfig, keypair: KeypairResult): string | undefined {
  const configured = cfg.credentials.publicKey;
  if (!keypair.publicKey || !configured || keypair.publicKey === configured) {
    return undefined;
  }
  return (
    'The configured public key does not belong to the same Unzer keypair as the configured private key. ' +
    'A shopper payment tokenized with that public key would be refused at charge time. ' +
    'Set both keys from the SAME keypair of the SAME Unzer account and environment.'
  );
}

/**
 * The one credential probe both the health check and the merchant test button run: `GET /v1/keypair/types`,
 * then the pair check. Every failure is a secret-free result; a mismatch names the public-key field.
 */
export async function probeKeypair(unzer: Pick<PspClient, 'keypair'>, cfg: StoreConfig): Promise<ConnectionTestResult> {
  try {
    const mismatch = keypairMismatch(cfg, await unzer.keypair.validate(toPspConnectionConfig(cfg)));
    return mismatch ? { success: false, message: mismatch, field: PUBLIC_KEY_FIELD } : { success: true };
  } catch (e) {
    return { success: false, message: e instanceof PspError ? e.message : 'PSP connection test failed' };
  }
}
