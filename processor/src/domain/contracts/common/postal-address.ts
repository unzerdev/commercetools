/** The postal core every address shape in the connector shares. Every field is optional. */
export interface PostalAddress {
  street?: string;
  houseNumber?: string;
  city?: string;
  postalCode?: string;
  /** ISO-3166-1 alpha-2. */
  countryCode?: string;
  state?: string;
}
