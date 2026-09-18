import { DEFAULT_SCOPE_STORE_KEY, isDefaultScope, type StoreSummary } from '../../../domain';
import type { OrchestrationCtx, OrchestrationDeps } from '../shared';

const DEFAULT_SCOPE_ENTRY: StoreSummary = { key: DEFAULT_SCOPE_STORE_KEY, name: 'Default', isDefault: true };

/** `GET /operations/stores`: the default scope first, then every project store; a store colliding with the reserved key is dropped. */
export async function listStores(_ctx: OrchestrationCtx, deps: OrchestrationDeps): Promise<StoreSummary[]> {
  const stores = await deps.ports.projectStoreReader.listStores();
  return [DEFAULT_SCOPE_ENTRY, ...stores.filter((store) => !isDefaultScope(store.key))];
}
