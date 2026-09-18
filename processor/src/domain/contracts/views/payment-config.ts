import type { EnvironmentMode } from '../common';
import type { ShopperPaymentMethod } from './shopper-payment-method';
import type { ShopperPrefill } from './shopper-prefill';

/** The shopper-facing payment config; carries the vendor public key only, never a secret. */
export interface PaymentConfig {
  publicKey: string;
  environment: EnvironmentMode;
  locale: string;
  currency: string;
  fractionDigits: number;
  /** Cart total in minor units, without a method surcharge. */
  amount: number;
  customerType: 'B2B' | 'B2C';
  /** ISO-3166 alpha-2 the purchase is made from, when the cart names one. */
  country?: string;
  paymentMethods: ShopperPaymentMethod[];
  shopper?: ShopperPrefill;
}
