import type { PaymentModificationStatus } from '../commercetools';

/** The outcome of a merchant modification, with the vendor's own reference for it. */
export interface ModificationResultView {
  outcome: PaymentModificationStatus;
  pspReference: string;
}
