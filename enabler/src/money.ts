import type { PaymentConfig } from './payment-enabler/payment-config';

/**
 * Render a minor-unit amount in the cart currency's major units. Without a resolved currency the
 * currency-styled formatter would throw, so a sparse config falls back to a plain decimal. The digits
 * are stated rather than left to `Intl`, which resolves CLDR's exponent and gives `RSD` 0 minor digits
 * where commercetools stores 2: a 50-minor-unit surcharge would read as `1 RSD` on the surface the
 * shopper consents on while `POST /payments` charges 50.
 */
export const formatMinorUnits = (
  config: Pick<PaymentConfig, 'locale' | 'currency' | 'fractionDigits'>,
  minorUnits: number,
): string => {
  const { locale, currency, fractionDigits } = config;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    ...(currency ? { style: 'currency', currency } : {}),
  }).format(minorUnits / 10 ** fractionDigits);
};
