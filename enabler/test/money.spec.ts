import { describe, expect, it } from '@jest/globals';
import { formatMinorUnits } from '../src/money';

/**
 * The one money formatter the enabler's own chrome uses (the surcharge on a row and above a form). The digits
 * come from the config, never from `Intl`'s CLDR exponent, so a currency commercetools stores with 2 minor
 * digits and CLDR lists with 0 still reads the way it is charged.
 */
describe('formatMinorUnits', () => {
  it('renders a two-digit currency in major units', () => {
    expect(formatMinorUnits({ locale: 'en-GB', currency: 'EUR', fractionDigits: 2 }, 150)).toBe('€1.50');
  });

  it("uses the config's digits, not the currency's CLDR exponent", () => {
    expect(formatMinorUnits({ locale: 'en-GB', currency: 'RSD', fractionDigits: 2 }, 50)).toContain('0.50');
  });

  it('falls back to a plain decimal when no currency is resolved', () => {
    expect(formatMinorUnits({ locale: 'en-GB', currency: '', fractionDigits: 2 }, 150)).toBe('1.50');
  });
});
