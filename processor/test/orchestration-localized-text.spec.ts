/**
 * The server-side localized-text resolver mirrors the MC `method-display.ts` fallback chain, so a
 * method's name/description reach the shopper already resolved: exact locale → base language →
 * first authored value → '' (never the method code — the code is a separate wire field).
 */
import { describe, expect, test } from '@jest/globals';
import { resolveLocalized } from '../src/application/orchestration';

describe('resolveLocalized — locale → base language → first authored → empty', () => {
  test('exact locale match wins', () => {
    expect(resolveLocalized({ 'en-US': 'Card', en: 'Karte' }, 'en-US')).toBe('Card');
  });

  test('falls back to the base language when the region variant is absent', () => {
    expect(resolveLocalized({ en: 'Card' }, 'en-GB')).toBe('Card');
  });

  test('falls back to the first authored value when neither locale nor base match', () => {
    expect(resolveLocalized({ de: 'Karte' }, 'fr')).toBe('Karte');
  });

  test('an empty text bag resolves to the empty string, never the caller-supplied fallback', () => {
    expect(resolveLocalized({}, 'en')).toBe('');
  });

  test('an undefined locale resolves to the first authored value', () => {
    expect(resolveLocalized({ nl: 'Kaart' })).toBe('Kaart');
  });
});
