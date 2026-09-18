import type { ModificationRequest } from '../../../domain';
import type { OrchestrationCtx } from '../shared';

/** The merchant intent: the payment the panel acts on. The store is derived from it, never received. */
export interface MerchantIntentCtx extends OrchestrationCtx {
  paymentId: string;
  data: ModificationRequest;
}
