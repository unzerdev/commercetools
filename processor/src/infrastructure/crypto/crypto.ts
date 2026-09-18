import crypto, { CipherGCMTypes } from 'crypto';

const ALGORITHM: CipherGCMTypes = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_ID_LENGTH = 12;
const ENCODING: BufferEncoding = 'hex';
const HEX_ONLY = /^[0-9a-f]+$/;

interface Key {
  readonly material: Uint8Array;
  /** The first 12 hex chars of SHA-256(material): names the key that sealed a value without exposing it. */
  readonly id: string;
}

/** 64 hex chars are the 32 raw key bytes; anything else is SHA-256'd down to 32 bytes. */
function keyMaterialFrom(raw: string): Uint8Array {
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return new Uint8Array(Buffer.from(raw, 'hex'));
  }
  return new Uint8Array(crypto.createHash('sha256').update(raw).digest());
}

function keyFrom(raw: string): Key {
  const material = keyMaterialFrom(raw);
  return { material, id: crypto.createHash('sha256').update(material).digest('hex').slice(0, KEY_ID_LENGTH) };
}

const present = (raw: string | undefined): raw is string => !!raw && raw.trim() !== '';

/** Key material parsed once per distinct env value; the env cannot change without a restart, tests swap it per case. */
const keyMemo = new Map<string, Key>();

function memoizedKey(raw: string): Key {
  const cached = keyMemo.get(raw);
  if (cached) {
    return cached;
  }
  const key = keyFrom(raw);
  keyMemo.set(raw, key);
  return key;
}

/** The current key; throws when `ENCRYPTION_KEY` is unset or blank. */
function currentKey(): Key {
  const raw = process.env.ENCRYPTION_KEY;
  if (!present(raw)) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return memoizedKey(raw);
}

/** The previous key, present only during rotation. */
function previousKey(): Key | undefined {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS;
  return present(raw) ? memoizedKey(raw) : undefined;
}

/** The current key's fingerprint; throws when the key is unset. */
export function currentKeyId(): string {
  return currentKey().id;
}

/** Whether a non-blank `ENCRYPTION_KEY` is configured. */
export function encryptionKeyConfigured(): boolean {
  return present(process.env.ENCRYPTION_KEY);
}

/** AES-256-GCM under the current key, as `v1:<key-id>:<iv>:<tag>:<ciphertext>` in lowercase hex. */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  const key = currentKey();
  const iv = new Uint8Array(crypto.randomBytes(IV_LENGTH));
  const cipher = crypto.createCipheriv(ALGORITHM, key.material, iv);

  let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
  encrypted += cipher.final(ENCODING);

  const authTag = cipher.getAuthTag();

  return `${VERSION}:${key.id}:${Buffer.from(iv).toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
}

/** Whether a value is a v1 envelope. */
export function isEncrypted(value: string): boolean {
  if (!value) {
    return false;
  }

  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    return false;
  }

  const [, keyId, iv, tag, ciphertext] = parts;
  return (
    keyId.length === KEY_ID_LENGTH &&
    iv.length === IV_LENGTH * 2 &&
    tag.length === AUTH_TAG_LENGTH * 2 &&
    ciphertext.length > 0 &&
    HEX_ONLY.test(keyId) &&
    HEX_ONLY.test(iv) &&
    HEX_ONLY.test(tag) &&
    HEX_ONLY.test(ciphertext)
  );
}

/** The envelope's key-id, or `undefined` for a plaintext value. */
export function keyIdOf(value: string): string | undefined {
  if (!isEncrypted(value)) {
    return undefined;
  }
  return value.split(':')[1];
}

function configuredKeyIds(): Set<string> {
  const ids = new Set<string>();
  for (const raw of [process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_KEY_PREVIOUS]) {
    if (present(raw)) {
      ids.add(memoizedKey(raw).id);
    }
  }
  return ids;
}

/** Whether a configured key matches the envelope's key-id, read without decrypting; never throws. */
export function keyIdResolvable(value: string): boolean {
  const keyId = keyIdOf(value);
  if (keyId === undefined) {
    return false;
  }
  return configuredKeyIds().has(keyId);
}

/** Fail-closed: a plaintext value passes through, an envelope no configured key can open throws. Never logs. */
export function decrypt(value: string): string {
  if (!isEncrypted(value)) {
    return value;
  }

  const [, keyId, ivHex, tagHex, ciphertext] = value.split(':');

  const key = [currentKey(), previousKey()].find((candidate) => candidate?.id === keyId);
  if (!key) {
    throw new Error('Failed to decrypt an encrypted configuration value: no configured key matches the stored key-id.');
  }

  try {
    const iv = new Uint8Array(Buffer.from(ivHex, ENCODING));
    const authTag = new Uint8Array(Buffer.from(tagHex, ENCODING));

    const decipher = crypto.createDecipheriv(ALGORITHM, key.material, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    throw new Error(
      'Failed to decrypt an encrypted configuration value (corrupted/tampered ciphertext or bad GCM auth tag).',
    );
  }
}

/** Domain separation keeps the HMAC use disjoint from the AES-GCM use and versions the token formula. */
const WEBHOOK_TOKEN_INFO = 'psp-webhook-url-token:v1:';

function tokenFor(key: Key, storeKey: string): string {
  return crypto
    .createHmac('sha256', key.material)
    .update(WEBHOOK_TOKEN_INFO + storeKey, 'utf8')
    .digest('base64url');
}

/** The store's webhook capability token from the current key: deterministic, 43 base64url chars. */
export function webhookUrlToken(storeKey: string): string {
  return tokenFor(currentKey(), storeKey);
}

/** Constant-time check against the current, then the previous key. Fail-closed and total: never throws, never logs. */
export function verifyWebhookUrlToken(storeKey: string, candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  let keys: Key[];
  try {
    keys = [currentKey(), previousKey()].filter((key): key is Key => key !== undefined);
  } catch {
    return false;
  }

  const candidateBytes = new Uint8Array(Buffer.from(candidate, 'utf8'));
  return keys.some((key) => {
    const expected = new Uint8Array(Buffer.from(tokenFor(key, storeKey), 'utf8'));
    return candidateBytes.length === expected.length && crypto.timingSafeEqual(candidateBytes, expected);
  });
}
