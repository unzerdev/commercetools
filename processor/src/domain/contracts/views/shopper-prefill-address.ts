import type { PostalAddress } from '../common';

/** One prefillable address; `name` is the addressee as one string, as the vendor form takes it. */
export interface ShopperPrefillAddress extends PostalAddress {
  name?: string;
  company?: string;
}
