import type { GooglePayButtonType } from './google-pay-button-type';

/** Google Pay's merchant identity and button, for the Google Pay method only. Absent fields fall back to Google's defaults. */
export interface GooglePayMethodConfig {
  /** The vendor channel, stamped by the connector on save; never typed by the merchant. */
  gatewayMerchantId?: string;
  merchantId?: string;
  merchantName?: string;
  countryCode?: 'DK' | 'CH';
  allowedCardNetworks?: string[];
  allowCreditCards?: boolean;
  allowPrepaidCards?: boolean;
  buttonColor?: 'default' | 'black' | 'white';
  buttonType?: GooglePayButtonType;
  buttonSizeMode?: 'static' | 'fill';
}
