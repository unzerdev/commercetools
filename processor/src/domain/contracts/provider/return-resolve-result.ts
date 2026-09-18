import type { FollowUpAction } from './follow-up-action';
import type { ProviderStatusCode } from './provider-status-code';
import type { ProviderStatusInput } from './provider-status-input';

/** The definitive outcome of a shopper return. */
export interface ReturnResolveResult {
  providerPaymentId: string;
  providerOperationId?: string;
  rawStatus: ProviderStatusInput;
  statusCode?: ProviderStatusCode;
  action?: FollowUpAction;
}
