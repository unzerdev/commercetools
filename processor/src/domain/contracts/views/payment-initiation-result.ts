import type { FollowUpAction } from '../provider';

/** The create-payment result: the CT Payment id and what the surface does next. */
export interface PaymentInitiationResult {
  paymentReference: string;
  action: FollowUpAction;
}
