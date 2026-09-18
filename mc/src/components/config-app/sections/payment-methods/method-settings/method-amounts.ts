/**
 * The money boundary of the settings form: the DTO persists per-currency MINOR units, the form
 * edits MAJOR units, and every conversion between them lives here - keyed on the currency's own fraction
 * digits, so no caller has to remember that JPY is 1:1.
 */
import type { CurrencyAmounts } from '../../../../../types/config';

/** One amount field's per-currency draft text, as typed (major units), keyed by currency code. */
export type AmountText = Record<string, string>;

/** The ISO-4217 minor-unit exponent for a currency (2 for most, 0 for JPY, …); defaults to 2. */
export const fractionDigitsFor = (currency: string): number => {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};

/** The smallest step the currency can express: `0.01` for EUR, `1` for a 0-decimal JPY. */
export const stepFor = (currency: string): number =>
  10 ** -fractionDigitsFor(currency);

/** The empty-field hint, in the shape that currency's amounts take (`0.00`, or `0` for JPY). */
export const placeholderFor = (currency: string): string =>
  (0).toFixed(fractionDigitsFor(currency));

/** Minor units → a fixed-decimal major-unit string; an absent amount is the empty field. */
export const minorToMajor = (
  minor: number | undefined,
  digits: number
): string =>
  minor === undefined ? '' : (minor / 10 ** digits).toFixed(digits);

/** A major-unit field → integer minor units; an empty/invalid field clears the (optional) amount. */
export const majorToMinor = (
  raw: string,
  digits: number
): number | undefined => {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 10 ** digits);
};

/** Seed one amount field's per-currency draft text from the persisted minor-unit map. */
export const seedAmountText = (
  amounts: CurrencyAmounts | undefined,
  currencies: string[]
): AmountText =>
  Object.fromEntries(
    currencies.map((currency) => [
      currency,
      minorToMajor(amounts?.[currency], fractionDigitsFor(currency)),
    ])
  );

/** A per-currency draft back to a minor-unit map; a currency left empty is simply not in the map. */
export const toAmounts = (text: AmountText): CurrencyAmounts => {
  const amounts: CurrencyAmounts = {};
  for (const [currency, raw] of Object.entries(text)) {
    const minor = majorToMinor(raw, fractionDigitsFor(currency));
    if (minor !== undefined) amounts[currency] = minor;
  }
  return amounts;
};

/**
 * The currencies the amounts can be configured in: the store's own, PLUS any currency the persisted
 * config already carries. A project that drops a currency must not silently hide (and then drop on the
 * next save) an amount the merchant configured for it.
 */
export const amountCurrenciesFor = (
  storeCurrencies: string[],
  ...configured: (CurrencyAmounts | undefined)[]
): string[] => {
  const all = new Set([
    ...storeCurrencies,
    ...configured.flatMap((amounts) => Object.keys(amounts ?? {})),
  ]);
  return all.size > 0 ? [...all].sort() : ['EUR'];
};
