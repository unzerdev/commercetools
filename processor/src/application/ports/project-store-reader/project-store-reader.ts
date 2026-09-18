import type { StoreSummary } from '../../../domain';
import type { ProjectReference } from './project-reference';
import type { StoreReference } from './store-reference';

/** Reference data from commercetools Stores and Project settings. */
export interface ProjectStoreReader {
  readStore(storeKey: string): Promise<StoreReference>;

  /** The store-existence probe the `/operations` authorization runs; a 404 is `false`, anything else propagates. */
  storeExists(storeKey: string): Promise<boolean>;

  readProjectSettings(): Promise<ProjectReference>;

  listStores(): Promise<StoreSummary[]>;
}
