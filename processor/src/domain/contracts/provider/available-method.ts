/** One entry of the live method catalogue: a code the account may serve and the vendor's coverage for it. */
export interface AvailableMethod {
  code: string;
  supportsAuthorize: boolean;
  supportsCharge: boolean;
  /** ISO-3166 alpha-2; empty means every country. */
  countries: string[];
  /** ISO-4217; empty means every currency. */
  currencies: string[];
  /** `B2B` / `B2C`; empty means both. */
  customerTypes: string[];
  /** Card networks in the method surface's own spelling; empty when the vendor states none. */
  cardNetworks: string[];
  /** The vendor channel, when stated; Google Pay's gateway merchant id. */
  channel?: string;
}
