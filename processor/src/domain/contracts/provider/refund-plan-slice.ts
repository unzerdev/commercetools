import type { Money } from '../common';

/** One vendor operation a refund resolves to. */
export interface RefundPlanSlice {
  /** The vendor operation this slice draws on; absent when the vendor refunds the payment as a whole. */
  targetOperationId?: string;
  amount: Money;
}
