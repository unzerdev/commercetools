import type { EnvironmentMode, StoreConfig, StoredStoreConfig } from '../../../../domain';

/** The incoming environment's credentials and host overlaid on the resolved base, `mode` forced to that environment; never persisted. */
export function overlayProbeConfig(base: StoreConfig, incoming: StoredStoreConfig, mode: EnvironmentMode): StoreConfig {
  const envBlock = incoming.environments?.[mode] ?? {};
  return {
    ...base,
    mode,
    credentials: { ...base.credentials, ...(envBlock.credentials ?? {}) },
    host: envBlock.host ?? base.host,
  };
}
