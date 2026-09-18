import type { PostalAddress, Shopper } from '../common';

/** What the checkout surface collected from the shopper; fills the cart's gaps, never overrides it. */
export interface CollectedCustomer extends Shopper {
  phone?: string;
  billingAddress?: PostalAddress;
  shippingAddress?: PostalAddress;
}
