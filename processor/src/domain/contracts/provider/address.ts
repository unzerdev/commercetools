import type { PostalAddress } from '../common';

/** A postal address plus the contact the vendor customer resource reads. */
export interface Address extends PostalAddress {
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  /** Kept apart from `phone`: the vendor requires a mobile for some methods. */
  mobile?: string;
  /** The platform's own form of address, mapped by the provider. */
  salutation?: string;
}
