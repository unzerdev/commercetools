import type { OrchestrationCtx } from '../../shared';

/** An optional explicit target store key (`X-Store-Key`). */
export interface TestConnectionCtx extends OrchestrationCtx {
  storeKey?: string;
}
