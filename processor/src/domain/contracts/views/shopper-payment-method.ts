import type { MethodSurfaceTraits, WalletData } from '../provider';

/** One shopper-selectable method, locale-resolved and filtered to the cart. */
export interface ShopperPaymentMethod extends Omit<MethodSurfaceTraits, 'carriesClickToPay'> {
  code: string;
  name: string;
  description: string;
  /** Minor units added when the method is chosen. */
  surcharge: number;
  logo?: string;
  wallet?: WalletData;
  /** Emitted only for the method that can carry Click to Pay; absent means the vendor default. */
  clickToPayEnabled?: boolean;
}
