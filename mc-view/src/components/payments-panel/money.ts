import type { IntlShape } from 'react-intl';
import type { MoneyDto } from '../../types/payments';

/**
 * commercetools wires money in minor units; the operator types and reads major units. The scale is the
 * `fractionDigits` the panel read carries for the payment — the exponent commercetools stores that
 * payment's amounts in — never a hardcoded 100 and never one resolved in the browser: `Intl` answers 0
 * minor digits for `RSD` where commercetools stores 2, so a locally resolved scale would turn a 500.00
 * RSD capture into 5.00 RSD at the vendor.
 */

const minorUnitScale = (fractionDigits: number): number => 10 ** fractionDigits;

export const toMajorUnit = (money: MoneyDto, fractionDigits: number): number =>
  money.centAmount / minorUnitScale(fractionDigits);

/** Round to the currency's minor unit: the processor's schema accepts an integer cent amount only. */
export const toMoney = (
  majorAmount: number,
  currencyCode: string,
  fractionDigits: number
): MoneyDto => ({
  centAmount: Math.round(majorAmount * minorUnitScale(fractionDigits)),
  currencyCode,
});

/**
 * The amount at the payment's own scale. The digits are stated rather than left to `Intl`, so a currency
 * CLDR gives fewer minor digits than commercetools stores is not rendered rounded: RSD 1,500.50 reads as
 * RSD 1,501 under CLDR's 0 digits, which is a different figure from the one the input holds.
 */
export const formatMoney = (
  intl: IntlShape,
  money: MoneyDto,
  fractionDigits: number
): string =>
  intl.formatNumber(toMajorUnit(money, fractionDigits), {
    style: 'currency',
    currency: money.currencyCode,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

/** An action has headroom only while its remaining amount is positive — the gate for its button. */
export const hasHeadroom = (money: MoneyDto): boolean => money.centAmount > 0;
