import { isDefaultScope, type StoreReferenceDataView } from '../../../domain';
import { type OrchestrationDeps, targetStoreKey } from '../shared';
import type { GetStoreReferenceDataCtx } from './store-reference-data-ctx';

/** `GET /operations/store-reference-data`: the Store's languages and countries when it scopes any, else the Project's; the Project's currencies. */
export async function getStoreReferenceData(
  ctx: GetStoreReferenceDataCtx,
  deps: OrchestrationDeps,
): Promise<StoreReferenceDataView> {
  const { projectStoreReader } = deps.ports;
  const storeKey = targetStoreKey(ctx.storeKey, deps);

  const [store, project] = await Promise.all([
    isDefaultScope(storeKey)
      ? Promise.resolve({ languages: [], countries: [] })
      : projectStoreReader.readStore(storeKey),
    projectStoreReader.readProjectSettings(),
  ]);

  return {
    languages: store.languages.length > 0 ? store.languages : project.languages,
    countries: store.countries.length > 0 ? store.countries : project.countries,
    currencies: project.currencies,
  };
}
