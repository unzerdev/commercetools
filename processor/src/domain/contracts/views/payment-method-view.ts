import type { PaymentMethodConfig } from '../config';

/** One method in the merchant GET view: the persisted config plus the read-only capabilities the catalogue derives. */
export interface PaymentMethodView extends PaymentMethodConfig {
  logo?: string;
  supportsAuthorize: boolean;
  supportsCharge: boolean;
  /** The vendor's coverage, distinct from the merchant's own `countries` restriction. */
  vendorCountries: string[];
  vendorCurrencies: string[];
  vendorCustomerTypes: string[];
  vendorChannel?: string;
  vendorCardNetworks: string[];
}
