import type { Money } from '../../../domain';

/** Currencies whose minor-unit exponent is not 2, for the read side where only the currency code is known. */
const CURRENCY_FRACTION_DIGITS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

/** The minor-unit exponent for a currency code; every unlisted currency reads at 2. */
export function fractionDigitsForCurrency(currencyCode: string | undefined): number {
  if (!currencyCode) {
    return 2;
  }
  return CURRENCY_FRACTION_DIGITS[currencyCode.toUpperCase()] ?? 2;
}

/** A minor-unit amount as Unzer's major-unit decimal string, integer math only; exponent 0 serializes bare. */
export function toDecimalAmount(minorUnits: number, fractionDigits: number): string {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  if (fractionDigits === 0) {
    return `${sign}${abs}`;
  }
  const scale = 10 ** fractionDigits;
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(fractionDigits, '0')}`;
}

/** The inverse: a decimal wire amount back to `Money`, integer math only; absent or malformed yields `undefined`. */
export function fromDecimalAmount(
  decimal: string | undefined,
  currencyCode: string | undefined,
  fractionDigits: number,
): Money | undefined {
  if (!decimal || !currencyCode) {
    return undefined;
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) {
    return undefined;
  }
  const [, sign, whole, frac = ''] = match;
  const scale = 10 ** fractionDigits;
  const fracUnits = fractionDigits === 0 ? 0 : Number(frac.slice(0, fractionDigits).padEnd(fractionDigits, '0'));
  const centAmount = Number(whole) * scale + fracUnits;
  return { centAmount: sign === '-' ? -centAmount : centAmount, currencyCode };
}
