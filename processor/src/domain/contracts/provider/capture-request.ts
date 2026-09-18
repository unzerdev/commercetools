import type { CentAmount } from '../common';
import type { OperationReference } from './operation-reference';

/** Capture (settle) an authorized payment. Currency is fixed by the authorization, so only the amount travels. */
export interface CaptureRequest {
  providerPaymentId: string;
  amount: CentAmount;
  fractionDigits: number;
  operationReference: OperationReference;
}
