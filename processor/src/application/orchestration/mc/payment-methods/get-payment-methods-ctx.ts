import type { EnvironmentMode } from '../../../../domain';
import type { OrchestrationCtx } from '../../shared';

/** An optional target store key and the environment whose catalogue is read; omitted, the active one. */
export interface GetPaymentMethodsCtx extends OrchestrationCtx {
  storeKey?: string;
  mode?: EnvironmentMode;
}
