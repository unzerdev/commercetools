import type { Shopper } from '../common';
import type { ShopperPrefillAddress } from './shopper-prefill-address';

/** What the platform knows about the payer, for prefilling a vendor customer form. Carries no secret. */
export interface ShopperPrefill extends Shopper {
  /** The platform customer id the vendor customer is created under; absent for a guest. */
  customerReference?: string;
  /** The vendor customer the account already holds under that reference, to update instead of re-create. */
  vendorCustomerId?: string;
  phone?: string;
  mobile?: string;
  /** Present switches the vendor form to B2B. */
  company?: string;
  billingAddress?: ShopperPrefillAddress;
  shippingAddress?: ShopperPrefillAddress;
}
