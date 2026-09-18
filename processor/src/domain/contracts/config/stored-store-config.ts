import type { EnvironmentMode } from '../common';
import type { StoreEnvironmentBlock } from './store-environment-block';

/** The persisted per-store config override (the Custom Object value). Every field optional: it is an override layer. */
export interface StoredStoreConfig {
  mode?: EnvironmentMode;
  environments?: { sandbox?: StoreEnvironmentBlock; live?: StoreEnvironmentBlock };
  /** The provider-owned settings document, opaque to the core. */
  settings?: unknown;
}
