import type { ProviderStatusCode } from './provider-status-code';
import type { ProviderStatusInput } from './provider-status-input';

/** The provider's answer to a capture, cancel or refund. */
export interface OperationResult {
  providerOperationId?: string;
  rawStatus: ProviderStatusInput;
  statusCode?: ProviderStatusCode;
}
