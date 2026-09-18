import { createIntl } from 'react-intl';
import {
  formatMoney,
  hasHeadroom,
  toMajorUnit,
  toMoney,
} from '../../../src/components/payments-panel/money';

/**
 * The operator types major units, the processor's schema accepts minor units. The scale is the exponent
 * the panel read carries for the payment (`fractionDigits`), never one resolved in the browser: a
 * zero-decimal currency (JPY) would be off by a factor of 100 under a hardcoded `/100`, and `Intl`
 * resolves 0 minor digits for `RSD` where commercetools stores 2 — the difference between capturing
 * 500.00 RSD and capturing 5.00 RSD.
 */

const intl = createIntl({ locale: 'en' });

/** `Intl` emits narrow no-break spaces; compare against the same normalization the DOM matcher uses. */
const normalize = (formatted: string) => formatted.replace(/\s/g, ' ');

describe('toMajorUnit', () => {
  it('scales a two-decimal currency by its fraction digits', () => {
    expect(toMajorUnit({ centAmount: 5025, currencyCode: 'EUR' }, 2)).toBe(
      50.25
    );
  });

  it('leaves a zero-decimal currency unscaled', () => {
    expect(toMajorUnit({ centAmount: 500, currencyCode: 'JPY' }, 0)).toBe(500);
  });

  it('scales a three-decimal currency by its fraction digits', () => {
    expect(toMajorUnit({ centAmount: 1500000, currencyCode: 'IQD' }, 3)).toBe(
      1500
    );
  });

  /**
   * The exponent is the figure the function is GIVEN, never one looked up from the currency code: the
   * same `RSD` amount reads differently at the two exponents, and only the payment's own
   * `fractionDigits` decides which is right. A lookup would answer both cases the same.
   */
  it.each([
    [2, 1500],
    [0, 150000],
  ])(
    'reads 150000 RSD minor units at exponent %s as %s',
    (digits, expected) => {
      expect(
        toMajorUnit({ centAmount: 150000, currencyCode: 'RSD' }, digits)
      ).toBe(expected);
    }
  );
});

describe('toMoney', () => {
  it('converts a typed major amount into the currency minor unit', () => {
    expect(toMoney(50.25, 'EUR', 2)).toEqual({
      centAmount: 5025,
      currencyCode: 'EUR',
    });
  });

  it('keeps a zero-decimal currency in its own unit', () => {
    expect(toMoney(500, 'JPY', 0)).toEqual({
      centAmount: 500,
      currencyCode: 'JPY',
    });
  });

  it('writes a typed RSD amount at the exponent commercetools stores it in', () => {
    expect(toMoney(500, 'RSD', 2)).toEqual({
      centAmount: 50000,
      currencyCode: 'RSD',
    });
  });

  // Binary floating point turns 19.99 * 100 into 1998.9999…; a truncation would silently under-charge.
  it('rounds to the nearest minor unit', () => {
    expect(toMoney(19.99, 'EUR', 2).centAmount).toBe(1999);
  });
});

describe('formatMoney', () => {
  it('renders a two-decimal currency with both minor digits', () => {
    expect(
      normalize(formatMoney(intl, { centAmount: 5025, currencyCode: 'EUR' }, 2))
    ).toBe('€50.25');
  });

  /**
   * The digits are stated rather than left to `Intl`: CLDR gives `RSD` zero minor digits, so 1,500.50
   * would render as RSD 1,501 — a different figure from the one the amount input holds.
   */
  it('renders a currency at the exponent the payment states, not the one CLDR resolves', () => {
    expect(
      normalize(
        formatMoney(intl, { centAmount: 150050, currencyCode: 'RSD' }, 2)
      )
    ).toBe('RSD 1,500.50');
  });
});

describe('hasHeadroom', () => {
  it.each([
    [0, false],
    [1, true],
  ])('reports %s cents as headroom %s', (centAmount, expected) => {
    expect(hasHeadroom({ centAmount, currencyCode: 'EUR' })).toBe(expected);
  });
});
