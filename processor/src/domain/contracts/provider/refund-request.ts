import type { Money } from '../common';
import type { OperationReference } from './operation-reference';

/** Refund a captured payment: the named amount, or everything when absent. */
export interface RefundRequest {
  providerPaymentId: string;
  amount?: Money;
  /** The vendor operation this refund draws on, when the plan named one. */
  targetOperationId?: string;
  paymentMethod?: string;
  fractionDigits: number;
  operationReference: OperationReference;
}
