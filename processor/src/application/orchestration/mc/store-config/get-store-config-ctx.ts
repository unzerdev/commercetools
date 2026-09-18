import type { OrchestrationCtx } from '../../shared';

/** An optional explicit target store key (`X-Store-Key`). */
export interface GetStoreConfigCtx extends OrchestrationCtx {
  storeKey?: string;
}
