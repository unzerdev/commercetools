import type { BookingMode, LocalizedText } from '../common';
import type { ApplePayMethodConfig } from './apple-pay-method-config';
import type { CurrencyAmounts } from './currency-amounts';
import type { GooglePayMethodConfig } from './google-pay-method-config';

/** One payment method's persisted configuration. Amounts are per currency in minor units. */
export interface PaymentMethodConfig {
  paymentMethodCode: string;
  enabled: boolean;
  name: LocalizedText;
  description: LocalizedText;
  /** Present only for methods that support both kinds. */
  bookingMode?: BookingMode;
  minAmount?: CurrencyAmounts;
  maxAmount?: CurrencyAmounts;
  surcharge: CurrencyAmounts;
  /** ISO-3166 alpha-2; empty means every country the vendor serves. */
  countries: string[];
  sendBasketData: boolean;
  /** Card method only; absent means off. */
  clickToPayEnabled?: boolean;
  googlePay?: GooglePayMethodConfig;
  applePay?: ApplePayMethodConfig;
}
