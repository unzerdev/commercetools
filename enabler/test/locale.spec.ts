import { describe, expect, it } from '@jest/globals';
import { CHECKOUT_LOCALES, formatText, resolveCheckoutLocale, resolveShopperTexts, SHOPPER_TEXTS } from '../src/locale';

describe('resolveCheckoutLocale', () => {
  it('takes an exact code', () => {
    expect(resolveCheckoutLocale('de')).toBe('de');
    expect(resolveCheckoutLocale('sr-RS')).toBe('sr-RS');
  });

  it('normalizes casing before matching', () => {
    expect(resolveCheckoutLocale('DE-de')).toBe('de');
    expect(resolveCheckoutLocale('SR-rs')).toBe('sr-RS');
    expect(resolveCheckoutLocale('de_DE')).toBe('de');
  });

  it('falls back to the first entry sharing the primary subtag', () => {
    // The table holds the bare `de`, so a regioned request lands on it.
    expect(resolveCheckoutLocale('de-DE')).toBe('de');
    // The table holds only the regioned Serbian, so a bare request lands on it.
    expect(resolveCheckoutLocale('sr')).toBe('sr-RS');
    expect(resolveCheckoutLocale('pt-BR')).toBe('pt-PT');
  });

  it('prefers the bare en over en-US for another English region', () => {
    expect(resolveCheckoutLocale('en-GB')).toBe('en');
  });

  it('falls back to en for a locale the table does not carry, and for no locale at all', () => {
    expect(resolveCheckoutLocale('ja-JP')).toBe('en');
    expect(resolveCheckoutLocale('')).toBe('en');
    expect(resolveCheckoutLocale('   ')).toBe('en');
    expect(resolveCheckoutLocale(undefined)).toBe('en');
  });
});

describe('SHOPPER_TEXTS', () => {
  it('carries 25 locales, en first', () => {
    expect(CHECKOUT_LOCALES).toHaveLength(25);
    expect(CHECKOUT_LOCALES[0]).toBe('en');
    expect(CHECKOUT_LOCALES.indexOf('en')).toBeLessThan(CHECKOUT_LOCALES.indexOf('en-US'));
  });

  it('carries a non-empty value for every key of every locale', () => {
    const empty: string[] = [];
    for (const locale of CHECKOUT_LOCALES) {
      for (const [key, value] of Object.entries(SHOPPER_TEXTS[locale])) {
        if (typeof value !== 'string' || value.trim() === '') {
          empty.push(`${locale}.${key}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it('carries the same key set in every locale as in English', () => {
    const englishKeys = Object.keys(SHOPPER_TEXTS.en).sort();
    for (const locale of CHECKOUT_LOCALES) {
      expect(Object.keys(SHOPPER_TEXTS[locale]).sort()).toEqual(englishKeys);
    }
  });

  it('carries no placeholder in a key English writes without one', () => {
    const withoutPlaceholders = [
      'paymentFailed',
      'paymentInitFailed',
      'formLoadFailed',
      'noPaymentMethods',
      'paymentDetailsIncomplete',
      'useVendorButton',
    ];
    for (const locale of CHECKOUT_LOCALES) {
      for (const key of withoutPlaceholders) {
        expect(SHOPPER_TEXTS[locale][key as keyof (typeof SHOPPER_TEXTS)['en']]).not.toContain('{');
      }
    }
  });

  it('resolves texts through the same chain', () => {
    expect(resolveShopperTexts('de-DE').noPaymentMethods).toBe(SHOPPER_TEXTS.de.noPaymentMethods);
    expect(resolveShopperTexts('ja').noPaymentMethods).toBe(SHOPPER_TEXTS.en.noPaymentMethods);
    expect(resolveShopperTexts(undefined)).toBe(SHOPPER_TEXTS.en);
  });
});

describe('formatText', () => {
  it('substitutes a named placeholder', () => {
    expect(formatText('Pay with {card}', { card: '•••• 4242' })).toBe('Pay with •••• 4242');
  });

  it('substitutes every occurrence and leaves an unsupplied placeholder visible', () => {
    expect(formatText('{a} and {a} and {b}', { a: 'x' })).toBe('x and x and {b}');
  });
});
