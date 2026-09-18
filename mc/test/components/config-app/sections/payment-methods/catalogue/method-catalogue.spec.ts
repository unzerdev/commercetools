import {
  fallbackPaymentLogo,
  paymentLogos,
} from '../../../../../../src/assets/payment-logos';
import {
  UNZER_DOCS_URL,
  UNZER_METHODS,
  unzerMethodBookingMode,
  unzerMethodDocsUrl,
  unzerMethodName,
  unzerMethodRequiresBasket,
} from '../../../../../../src/components/config-app/sections/payment-methods/catalogue/method-catalogue';
import { unzerMethodDescription } from '../../../../../../src/components/config-app/sections/payment-methods/catalogue/method-descriptions';
import { paymentLogoFor } from '../../../../../../src/components/config-app/sections/payment-methods/catalogue/payment-method-logo';
import { methodDisplayName } from '../../../../../../src/components/config-app/sections/payment-methods/catalogue/method-display';
import type { UnzerMethodConfigDto } from '../../../../../../src/types/config';

/**
 * The vendor catalogue behind the methods list: Unzer's own name, its documentation page and its logo,
 * per method-type code. What is pinned here is the WIRING — every known code resolves all three, an
 * unknown one degrades instead of breaking — plus the handful of names and slugs an operator could not
 * derive from the code, which is exactly why the catalogue exists.
 */

const method = (
  paymentMethodCode: string,
  name: Record<string, string> = {}
): UnzerMethodConfigDto => ({
  paymentMethodCode,
  enabled: false,
  name,
  description: {},
  surcharge: {},
  countries: [],
  sendBasketData: false,
});

describe('Unzer method catalogue', () => {
  it('gives every known method type a name, a documentation page and a logo', () => {
    for (const [code, descriptor] of Object.entries(UNZER_METHODS)) {
      expect(descriptor.name).not.toHaveLength(0);
      expect(descriptor.docsUrl).toMatch(
        /^https:\/\/docs\.unzer\.com\/payment-methods\/[a-z0-9-]+\/$/
      );
      expect(paymentLogoFor(code)).toBeDefined();
    }
  });

  it('bundles no logo that no method type claims', () => {
    for (const code of Object.keys(paymentLogos)) {
      expect(UNZER_METHODS[code]).toBeDefined();
    }
  });

  // The codes whose vendor name and documentation slug are unguessable from the code itself.
  it.each([
    ['paylater-invoice', 'Unzer Invoice', 'invoice'],
    ['paylater-installment', 'Unzer Installment', 'installment'],
    ['paylater-direct-debit', 'Unzer Direct Debit', 'direct-debit'],
    ['openbanking-pis', 'Direct Bank Transfer', 'direct-bank-transfer'],
    ['card', 'Cards and Click to Pay', 'card'],
    ['wechatpay', 'WeChat Pay', 'wechat-pay'],
  ])('names %s "%s" and documents it at /%s/', (code, name, slug) => {
    expect(unzerMethodName(code)).toBe(name);
    expect(unzerMethodDocsUrl(code)).toBe(
      `https://docs.unzer.com/payment-methods/${slug}/`
    );
  });

  it('matches a code case-insensitively (Unzer spells one of them EPS)', () => {
    expect(unzerMethodName('EPS')).toBe('EPS');
    expect(paymentLogoFor('EPS')).toBe(paymentLogoFor('eps'));
  });

  // Each of these is a vendor fact the screen acts on: an authorize-only method offers no choice, and a
  // BNPL method always sends the basket. A wrong entry is a payment the vendor rejects.
  it.each([
    ['card', 'both', false],
    ['paypal', 'both', false],
    ['twint', 'charge', false],
    ['klarna', 'authorize', true],
    ['paylater-invoice', 'authorize', true],
    ['paylater-installment', 'authorize', true],
    ['paylater-direct-debit', 'authorize', true],
  ])('%s is %s and %s the basket', (code, bookingMode, requiresBasket) => {
    expect(unzerMethodBookingMode(code)).toBe(bookingMode);
    expect(unzerMethodRequiresBasket(code)).toBe(requiresBasket);
  });

  it('gives every method a translated description', () => {
    for (const code of Object.keys(UNZER_METHODS)) {
      expect(unzerMethodDescription(code)?.defaultMessage).toBeTruthy();
    }
  });

  // The catalogue is DRIVEN BY THE PROVIDER, so a code this release never heard of is ordinary. It still
  // has to render as an Unzer payment method rather than as a hole in the row.
  it('falls back to the Unzer mark for a code with no bundled logo', () => {
    expect(paymentLogoFor('brand-new-method')).toBeUndefined();
    expect(fallbackPaymentLogo).toBeTruthy();
    // And it is not smuggled into the method map: the Unzer mark belongs to no method code. Asserted on
    // the KEYS - jest maps every asset import to one shared stub, so the values cannot tell them apart.
    expect(Object.keys(paymentLogos)).not.toContain('unzer');
  });

  it('degrades for a code the vendor added after this catalogue', () => {
    expect(unzerMethodName('brand-new-method')).toBeUndefined();
    expect(unzerMethodDocsUrl('brand-new-method')).toBe(UNZER_DOCS_URL);
    expect(paymentLogoFor('brand-new-method')).toBeUndefined();
    expect(unzerMethodDescription('brand-new-method')).toBeUndefined();
    // Nothing is claimed on its behalf: the screen offers the choice and the toggle instead of forcing
    // a mode or a basket the connector only guessed at.
    expect(unzerMethodBookingMode('brand-new-method')).toBe('both');
    expect(unzerMethodRequiresBasket('brand-new-method')).toBe(false);
  });
});

// The administration screen labels a method the way UNZER does. The merchant's own name is CHECKOUT copy
// (the `Payment method name` field), so it must not rename the row, the dialog title, or anything the
// operator matches against the vendor's portal - and it cannot make one environment read differently
// from the other.
describe('methodDisplayName', () => {
  it("uses Unzer's name rather than the raw code", () => {
    expect(methodDisplayName('paylater-invoice')).toBe('Unzer Invoice');
  });

  it('is FIXED: the merchant’s own checkout name never renames the method here', () => {
    // The authored name lives on the method and still travels to the shopper; it just does not label
    // this screen. Only the code decides what the operator reads.
    expect(
      methodDisplayName(
        method('paylater-invoice', { en: 'Buy now, pay later' })
          .paymentMethodCode
      )
    ).toBe('Unzer Invoice');
  });

  it('still renders an unknown code rather than nothing', () => {
    expect(methodDisplayName('brand-new-method')).toBe('brand-new-method');
  });
});
