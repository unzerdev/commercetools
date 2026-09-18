import type { ConfigHandler } from '../../../application/handlers';
import type {
  ConfigValidationResult,
  StoreConfig,
  StoreConfigView,
  StoredStoreConfig,
  StoreEnvironmentBlock,
} from '../../../domain';
import { mapStoredSecrets } from '../../../domain';
import { validatePspConfig } from './store-settings.schema';

/** The mask a redacted store-config response carries in place of every secret leaf. */
const REDACTED_SECRET = '***';

/**
 * The provider config concern: settings validation, the connection fields a connect requires, redaction and
 * masked-write-back reconciliation over the domain's secret topology, and the one shopper-safe credential.
 */
export class PspConfigHandler implements ConfigHandler {
  validate(rawSettings: unknown): ConfigValidationResult {
    return validatePspConfig(rawSettings);
  }

  /** Both keys of the pair are required to connect; this enforces presence only, the topology encrypts them. */
  missingConnectionFields(env: StoreEnvironmentBlock): string[] {
    const missing: string[] = [];
    if (!env.credentials?.publicKey) {
      missing.push('credentials.publicKey');
    }
    if (!env.credentials?.privateKey) {
      missing.push('credentials.privateKey');
    }
    return missing;
  }

  /**
   * The read projection: credentials return in the clear so an operator can see which key pair a store
   * holds (the route is JWT-authenticated and manage-gated; storage stays encrypted), `webhookSecret` masked.
   */
  redact(stored: StoredStoreConfig): StoreConfigView {
    return mapStoredSecrets(stored, () => REDACTED_SECRET, null, { credentials: false }) as StoreConfigView;
  }

  /** Substitute the stored value for every secret leaf re-sent as the mask; a masked leaf with no prior value is dropped. */
  reconcileSecrets(incoming: StoredStoreConfig, previous: StoredStoreConfig | null): StoredStoreConfig {
    return mapStoredSecrets(incoming, (value, prev) => (value === REDACTED_SECRET ? prev : value), previous);
  }

  /** The Unzer public key, the only credential a browser may hold. */
  shopperPublicKey(cfg: StoreConfig): string {
    return cfg.credentials.publicKey ?? '';
  }
}
