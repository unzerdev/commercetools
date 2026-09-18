import { encryptionKeyConfigured } from './crypto';

const TEMPLATE_PLACEHOLDER = 'replace-with-openssl-rand-hex-32';

const MIN_KEY_LENGTH = 32;

/** A configured key must not be the template placeholder nor shorter than 32 trimmed characters. Never echoes the value. */
function assertOneKeyStrength(name: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_PREVIOUS', raw: string | undefined): void {
  if (!raw || raw.trim() === '') {
    return;
  }
  const value = raw.trim();
  if (value === TEMPLATE_PLACEHOLDER || value.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${name} is a template placeholder or shorter than ${MIN_KEY_LENGTH} characters - too weak to protect ` +
        'the encrypted store secrets and the derived webhook capability-URL tokens. Generate a real key with: ' +
        'openssl rand -hex 32',
    );
  }
}

/** Refuse a weak current or previous key: the webhook token circulates publicly and is derived from it. */
export function assertEncryptionKeyStrength(): void {
  assertOneKeyStrength('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY);
  assertOneKeyStrength('ENCRYPTION_KEY_PREVIOUS', process.env.ENCRYPTION_KEY_PREVIOUS);
}

/** Refuse to boot without `ENCRYPTION_KEY`: the webhook token derives from it and every stored secret is sealed with it. */
export function assertEncryptionKeyRequired(): void {
  if (encryptionKeyConfigured()) {
    return;
  }
  throw new Error(
    'ENCRYPTION_KEY is required: the webhook capability-URL token is derived from it and every stored ' +
      'store-config secret is sealed with it. Generate one with `openssl rand -hex 32`.',
  );
}
