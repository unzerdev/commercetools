import type { ApplePayMethodConfig, GooglePayMethodConfig } from '../config';

/** What the provider needs from the core to build a `WalletData`. */
export interface WalletDataInput {
  googlePay?: GooglePayMethodConfig;
  applePay?: ApplePayMethodConfig;
  /** The vendor channel from the catalogue. */
  channel?: string;
  /** Card networks in the surface's own spelling. */
  cardNetworks?: string[];
  currencyCode: string;
  /** Cart total in minor units, without the method surcharge. */
  amountMinor: number;
  fractionDigits: number;
  countryCode?: string;
  storeName?: string;
  locale?: string;
}
