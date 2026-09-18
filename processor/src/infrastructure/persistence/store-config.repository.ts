import type { ClearEnvCredentialsResult, ConfigStore } from '../../application/ports';
import type { EnvironmentMode, StoredStoreConfig, StoreEnvironmentBlock, Versioned } from '../../domain';
import { mapStoredSecrets } from '../../domain';
import { ctClient } from '../commercetools';
import { getBrand } from '../config/brand';
import { decrypt, encrypt, isEncrypted } from '../crypto/crypto';

const container = (): string => getBrand().customObjectContainer;

const decryptSecrets = (value: StoredStoreConfig): StoredStoreConfig => mapStoredSecrets(value, (v) => decrypt(v));

/** The per-store override, decrypted; `null` when no object exists. */
export async function readStoreConfigObject(storeKey: string): Promise<StoredStoreConfig | null> {
  const record = await ctClient.customObjects.find<StoredStoreConfig>({ container: container(), key: storeKey });

  return record ? decryptSecrets(record.value) : null;
}

/** The override and its version in one GET, for a reconcile-then-CAS write. */
export async function readStoreConfigWithVersion(storeKey: string): Promise<Versioned<StoredStoreConfig>> {
  const record = await ctClient.customObjects.find<StoredStoreConfig>({ container: container(), key: storeKey });

  return record
    ? { value: decryptSecrets(record.value), version: record.version }
    : { value: null, version: undefined };
}

/** Several objects in one call, decrypted and keyed by store key; missing keys are absent from the result. */
export async function readStoreConfigObjects(keys: string[]): Promise<Record<string, StoredStoreConfig>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    return {};
  }

  const records = await ctClient.customObjects.query<StoredStoreConfig>({
    container: container(),
    where: 'key in :keys',
    vars: { 'var.keys': unique },
    limit: unique.length,
  });

  const objects: Record<string, StoredStoreConfig> = {};
  for (const record of records) {
    objects[record.key] = decryptSecrets(record.value);
  }
  return objects;
}

/** One stored object as it sits at rest: raw (still encrypted) value and version. */
export interface StoredConfigObjectEntry {
  key: string;
  value: StoredStoreConfig;
  version: number;
}

const LIST_PAGE_SIZE = 500;

/** Every object in the container, raw, paged; the re-encryption walk reads it. */
export async function listStoreConfigObjects(): Promise<StoredConfigObjectEntry[]> {
  const entries: StoredConfigObjectEntry[] = [];

  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const page = await ctClient.customObjects.query<StoredStoreConfig>({
      container: container(),
      limit: LIST_PAGE_SIZE,
      offset,
    });

    entries.push(...page);

    if (page.length < LIST_PAGE_SIZE) {
      return entries;
    }
  }
}

/** The one encrypt-at-rest write; returns the document as handed in (decrypted) with the new version. */
async function postStoreConfigObject(
  storeKey: string,
  value: StoredStoreConfig,
  version?: number,
): Promise<{ value: StoredStoreConfig; version: number }> {
  const encrypted = mapStoredSecrets(value, (plain) => (isEncrypted(plain) ? plain : encrypt(plain)));

  const record = await ctClient.customObjects.save<StoredStoreConfig>({
    container: container(),
    key: storeKey,
    value: encrypted,
    version,
  });

  return { value, version: record.version };
}

/** Upsert with optional CAS; returns the persisted document decrypted. */
export async function writeStoreConfigObject(
  storeKey: string,
  value: StoredStoreConfig,
  version?: number,
): Promise<StoredStoreConfig> {
  return (await postStoreConfigObject(storeKey, value, version)).value;
}

export async function deleteStoreConfigObject(storeKey: string, version?: number): Promise<void> {
  await ctClient.customObjects.remove({ container: container(), key: storeKey, version });
}

function hasCredentials(env: StoreEnvironmentBlock | undefined): boolean {
  return !!env?.credentials && Object.keys(env.credentials).length > 0;
}

/** Clear one environment's secret leaves on the raw object without decrypting; no rewrite when nothing remains. */
export async function clearEnvCredentials(
  storeKey: string,
  mode: EnvironmentMode,
): Promise<ClearEnvCredentialsResult | null> {
  const current = await ctClient.customObjects.find<StoredStoreConfig>({ container: container(), key: storeKey });
  if (!current) {
    return null;
  }

  const environments = current.value.environments ?? {};
  const nextEnvironments = { ...environments };
  const targetEnv = environments[mode];
  if (targetEnv) {
    const clearedEnv: StoreEnvironmentBlock = { ...targetEnv };
    delete clearedEnv.credentials;
    delete clearedEnv.webhookSecret;
    delete clearedEnv.webhookIds;
    if (Object.keys(clearedEnv).length > 0) {
      nextEnvironments[mode] = clearedEnv;
    } else {
      delete nextEnvironments[mode];
    }
  }

  const remainingCredentials = hasCredentials(nextEnvironments.sandbox) || hasCredentials(nextEnvironments.live);

  if (!remainingCredentials) {
    return { remainingCredentials: false, version: current.version };
  }

  const nextValue: StoredStoreConfig = { ...current.value, environments: nextEnvironments };
  const written = await postStoreConfigObject(storeKey, nextValue, current.version);

  return { remainingCredentials: true, version: written.version };
}

/** The `ConfigStore` port over this repository. */
export const configStore: ConfigStore = {
  read: readStoreConfigObject,
  readWithVersion: readStoreConfigWithVersion,
  write: writeStoreConfigObject,
  delete: deleteStoreConfigObject,
  clearEnvCredentials,
};
