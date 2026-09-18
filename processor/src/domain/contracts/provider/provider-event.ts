import type { Money } from '../common';
import type { ProviderStatusCode } from './provider-status-code';
import type { ProviderStatusInput } from './provider-status-input';
import type { SettlementKind } from './settlement-kind';

/** A normalized webhook event. A kind outside `SettlementKind` is the raw vendor name and is ignored. */
export interface ProviderEvent {
  kind: SettlementKind | string;
  /** The merchant reference read off the fetched payment; empty when the vendor echoes none. */
  paymentRef: string;
  /** The CT Payment id the connector stamped at pay time; the fallback anchor when `paymentRef` is empty. */
  platformPaymentId?: string;
  providerPaymentId: string;
  /** The per-operation id; the third segment of the idempotency marker key. */
  operationId: string;
  /** The settled leg's own amount. */
  amount?: Money;
  /** The cumulative amounts the partial-vs-full comparison reads. */
  totalAmount?: Money;
  cancelledAmount?: Money;
  acquiredAmount?: Money;
  rawStatus: ProviderStatusInput;
  statusCode?: ProviderStatusCode;
}
