import type { EnvironmentMode, StoredStoreConfig, Versioned } from '../../../domain';
import type { ClearEnvCredentialsResult } from './clear-env-credentials-result';

/** Per-store connection config persistence; secrets are encrypted at rest and decrypted on read. */
export interface ConfigStore {
  read(storeKey: string): Promise<StoredStoreConfig | null>;

  readWithVersion(storeKey: string): Promise<Versioned<StoredStoreConfig>>;

  /** Upsert with optional CAS; returns the persisted document decrypted. */
  write(storeKey: string, value: StoredStoreConfig, version?: number): Promise<StoredStoreConfig>;

  /** Idempotent delete with optional CAS. */
  delete(storeKey: string, version?: number): Promise<void>;

  /** Clears one environment's secret leaves; `null` when no object exists. */
  clearEnvCredentials(storeKey: string, mode: EnvironmentMode): Promise<ClearEnvCredentialsResult | null>;
}
