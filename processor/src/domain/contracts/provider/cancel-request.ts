import type { Money } from '../common';
import type { OperationReference } from './operation-reference';

/** Cancel (void) an authorization: the named amount, or everything still authorized when absent. */
export interface CancelRequest {
  providerPaymentId: string;
  amount?: Money;
  /** The CT Payment id the connector stamped at pay time; some methods are addressed by it. */
  merchantOrderId?: string;
  paymentMethod?: string;
  fractionDigits: number;
  operationReference: OperationReference;
}
