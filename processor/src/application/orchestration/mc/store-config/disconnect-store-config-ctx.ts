import type { EnvironmentMode } from '../../../../domain';
import type { OrchestrationCtx } from '../../shared';

/** An optional target store key and the environment to disconnect; `mode` absent falls back to the stored one. */
export interface DisconnectStoreConfigCtx extends OrchestrationCtx {
  storeKey?: string;
  mode?: EnvironmentMode;
}
