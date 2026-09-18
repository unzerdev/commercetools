import type { OrchestrationCtx } from '../shared';

/** The order the Custom View is mounted on. The store is derived from each payment. */
export interface GetOrderPaymentsCtx extends OrchestrationCtx {
  orderId: string;
}
