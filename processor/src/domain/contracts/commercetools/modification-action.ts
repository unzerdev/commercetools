import type { CancelModificationAction } from './cancel-modification-action';
import type { CaptureModificationAction } from './capture-modification-action';
import type { RefundModificationAction } from './refund-modification-action';
import type { ReverseModificationAction } from './reverse-modification-action';

/** The merchant modification actions a payment intent may carry. */
export type ModificationAction =
  CaptureModificationAction | RefundModificationAction | CancelModificationAction | ReverseModificationAction;
