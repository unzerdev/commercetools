import type { BookingMode } from '../common/booking-mode';
import type { FollowUpAction } from './follow-up-action';
import type { ProviderCustomFields } from './provider-custom-fields';
import type { ProviderStatusCode } from './provider-status-code';
import type { ProviderStatusInput } from './provider-status-input';

/** The provider's answer to a pay call. */
export interface PaymentResult {
  providerPaymentId: string;
  /** The vendor's id for this operation; the CT Transaction is keyed on it. */
  providerOperationId?: string;
  /** The kind actually booked once the method's own support had its say; the create leg types its Pending leg by it. */
  bookingMode: BookingMode;
  action: FollowUpAction;
  rawStatus: ProviderStatusInput;
  statusCode?: ProviderStatusCode;
  customFields?: ProviderCustomFields;
}
