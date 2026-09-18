import type { StoreConfigView } from '../../../../domain';
import { type OrchestrationDeps, targetStoreKey } from '../../shared';
import type { GetStoreConfigCtx } from './get-store-config-ctx';

/** The per-store configuration, secrets redacted; `{}` when the store is unconfigured. */
export async function getStoreConfig(ctx: GetStoreConfigCtx, deps: OrchestrationDeps): Promise<StoreConfigView> {
  const stored = await deps.ports.configStore.read(targetStoreKey(ctx.storeKey, deps));
  return stored ? deps.provider.config.redact(stored) : {};
}
