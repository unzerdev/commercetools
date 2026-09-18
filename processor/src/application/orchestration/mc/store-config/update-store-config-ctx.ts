import type { StoreConfigView } from '../../../../domain';
import type { OrchestrationCtx } from '../../shared';

/** The store-config payload plus an optional target store key (`X-Store-Key`). */
export interface UpdateStoreConfigCtx extends OrchestrationCtx {
  body: StoreConfigView;
  storeKey?: string;
}
