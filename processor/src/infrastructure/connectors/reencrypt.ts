import type { StoredStoreConfig } from '../../domain';
import { mapStoredSecrets } from '../../domain';
import { currentKeyId, decrypt, keyIdOf } from '../crypto/crypto';
import { listStoreConfigObjects, writeStoreConfigObject } from '../persistence/store-config.repository';

/** Decrypt every leaf under an old key-id so the write path re-seals it; a current or plaintext leaf is untouched. */
function rotateOldKeyLeaves(object: StoredStoreConfig): { value: StoredStoreConfig; dirty: boolean } {
  const current = currentKeyId();
  let dirty = false;

  const value = mapStoredSecrets(object, (leaf) => {
    const keyId = keyIdOf(leaf);
    if (keyId === undefined || keyId === current) {
      return leaf;
    }
    dirty = true;
    return decrypt(leaf);
  });

  return { value, dirty };
}

/** Re-wrap every connection object still sealed under the previous key; a no-op without one, idempotent otherwise. */
export async function reencryptStoreConfigs(): Promise<void> {
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!previous || previous.trim() === '') {
    return;
  }

  const objects = await listStoreConfigObjects();

  let rewritten = 0;
  for (const object of objects) {
    const { value, dirty } = rotateOldKeyLeaves(object.value);
    if (dirty) {
      await writeStoreConfigObject(object.key, value, object.version);
      rewritten += 1;
    }
  }

  process.stdout.write(
    `config re-encryption: ${rewritten} of ${objects.length} connection object(s) re-wrapped under the current key\n`,
  );
}
