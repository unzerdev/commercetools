import type {
  ConfigValidationResult,
  StoreConfig,
  StoreConfigView,
  StoredStoreConfig,
  StoreEnvironmentBlock,
} from '../../../domain';

/** The provider-owned config concern: schema validation, redaction, masked write-back and the shopper public key. */
export interface ConfigHandler {
  /** Strict validation of the provider settings document. */
  validate(rawSettings: unknown): ConfigValidationResult;

  /** The required connection fields absent from an environment being connected, as block-relative paths. */
  missingConnectionFields(env: StoreEnvironmentBlock): string[];

  /** Mask the secret leaves of a stored config for a response. */
  redact(stored: StoredStoreConfig): StoreConfigView;

  /** Substitute the stored value for every secret leaf re-sent as the mask, so the mask is never persisted. */
  reconcileSecrets(incoming: StoredStoreConfig, previous: StoredStoreConfig | null): StoredStoreConfig;

  /** The only credential a browser may hold; empty when the environment carries none. */
  shopperPublicKey(cfg: StoreConfig): string;
}
