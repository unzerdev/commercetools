import type { OrchestrationCtx } from '../shared';

/** The raw request bytes plus the store key and capability token from the route path. */
export interface HandleWebhookCtx extends OrchestrationCtx {
  storeKey: string;
  rawBody: Buffer;
  token: string;
}
