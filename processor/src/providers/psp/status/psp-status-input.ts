import type { PaymentState } from '../../../domain';

/**
 * This provider's status envelope: the interpreted `PaymentState` itself. The provider is the one place a
 * vendor resource is read, so it maps straight to the neutral state and `mapProviderStatus` only validates.
 */
export interface PspStatusInput {
  state: PaymentState;
  [key: string]: unknown;
}
