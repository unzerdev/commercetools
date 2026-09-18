/**
 * The WALLET payloads - Apple's and Google's own sheet data, assembled on the SERVER and handed to the vendor's
 * setter verbatim.
 *
 * Two things are pinned here and nowhere else: the exact SHAPE each vendor setter takes, and the PRECEDENCE -
 * the merchant's per-method configuration first, the platform's own documented default second, and nothing
 * invented.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildWalletData,
  isWalletMethod,
  rendersOwnPayButton,
  toSurfaceCardNetworks,
} from '../src/providers/psp/methods';

const purchase = { currencyCode: 'EUR', amountMinor: 1999, fractionDigits: 2 };

describe('isWalletMethod / rendersOwnPayButton', () => {
  it.each(['applepay', 'googlepay', 'APPLEPAY'])('recognises %s as a wallet', (code) => {
    expect(isWalletMethod(code)).toBe(true);
    // The wallet button IS the vendor's; a host that renders one shows two buttons of which one pays.
    expect(rendersOwnPayButton(code)).toBe(true);
  });

  it.each(['card', 'paypal', 'paylater-invoice'])('does not claim %s', (code) => {
    expect(isWalletMethod(code)).toBe(false);
    expect(rendersOwnPayButton(code)).toBe(false);
  });
});

describe('buildWalletData — Apple Pay', () => {
  it('sends the reference shape, with the vendor defaults where the merchant configured none', () => {
    const wallet = buildWalletData('applepay', { ...purchase, countryCode: 'DE', storeName: 'b2c-retail-store' });

    expect(wallet).toEqual({
      kind: 'applepay',
      payload: {
        countryCode: 'DE',
        currencyCode: 'EUR',
        // The account reported no brand in this case, so the sheet offers none - nothing is invented.
        supportedNetworks: [],
        merchantCapabilities: ['supports3DS'],
        // The connector already holds the shopper's address: asking Apple to collect one asks twice.
        requiredShippingContactFields: [],
        requiredBillingContactFields: [],
        // MAJOR units, as a string - what the sheet takes and what the reference sends.
        total: { label: 'b2c-retail-store', amount: '19.99' },
      },
    });
  });

  it('prefers the merchant label and networks over the defaults', () => {
    const wallet = buildWalletData('applepay', {
      ...purchase,
      storeName: 'b2c-retail-store',
      applePay: { label: 'Unzer Demo Shop', supportedNetworks: ['visa'] },
    });

    expect(wallet?.payload).toMatchObject({
      supportedNetworks: ['visa'],
      total: { label: 'Unzer Demo Shop', amount: '19.99' },
    });
  });

  // A cart with no country states none rather than inventing one; Apple then asks for what it needs.
  it('omits the country when the cart names none', () => {
    expect(buildWalletData('applepay', purchase)?.payload).not.toHaveProperty('countryCode');
  });
});

describe('buildWalletData — Google Pay', () => {
  it('sends the reference shape, with the vendor defaults where the merchant configured none', () => {
    const wallet = buildWalletData('googlepay', { ...purchase, channel: '9138634f404b' });

    expect(wallet).toEqual({
      kind: 'googlepay',
      payload: {
        // The gateway merchant id IS the Unzer channel - nothing the merchant types.
        gatewayMerchantId: '9138634f404b',
        transactionInfo: { countryCode: 'DK', currencyCode: 'EUR', totalPrice: '19.99' },
        // GOOGLE's own button defaults (`ButtonOptions`), which is the authority on its own widget.
        buttonOptions: { buttonColor: 'default', buttonType: 'buy', buttonSizeMode: 'fill' },
        allowedCardNetworks: [],
        allowCreditCards: true,
        allowPrepaidCards: true,
      },
    });
  });

  it('carries the merchant identity and button choices when configured', () => {
    const wallet = buildWalletData('googlepay', {
      ...purchase,
      channel: '9138634f404b',
      googlePay: {
        merchantId: '12345678901234567890',
        merchantName: 'Unzer Demo Shop',
        countryCode: 'CH',
        allowedCardNetworks: ['VISA'],
        allowCreditCards: false,
        allowPrepaidCards: false,
        buttonColor: 'black',
        buttonType: 'checkout',
        buttonSizeMode: 'static',
      },
    });

    expect(wallet?.payload).toEqual({
      gatewayMerchantId: '9138634f404b',
      merchantInfo: { merchantId: '12345678901234567890', merchantName: 'Unzer Demo Shop' },
      transactionInfo: { countryCode: 'CH', currencyCode: 'EUR', totalPrice: '19.99' },
      buttonOptions: {
        buttonColor: 'black',
        buttonType: 'checkout',
        buttonSizeMode: 'static',
      },
      allowedCardNetworks: ['VISA'],
      allowCreditCards: false,
      allowPrepaidCards: false,
    });
  });

  /**
   * No channel, no `gatewayMerchantId`: Google refuses the sheet without one, and stating an empty string would
   * fail the same way while hiding why. The same holds for `merchantInfo` - an empty object says nothing.
   */
  it('omits the gateway merchant id and the merchant info when neither is known', () => {
    const payload = buildWalletData('googlepay', purchase)?.payload ?? {};

    expect(payload).not.toHaveProperty('gatewayMerchantId');
    expect(payload).not.toHaveProperty('merchantInfo');
  });
});

// The amount is the ONE figure both sheets share, and it is formatted by the connector's own minor-to-major
// rule - so the sheet and the basket cannot disagree about what is being paid.
describe('buildWalletData — the amount', () => {
  it.each([
    ['two decimals', 1999, 2, '19.99'],
    ['no decimals (JPY)', 1999, 0, '1999'],
    ['three decimals (BHD)', 1999, 3, '1.999'],
  ])('formats the total in major units — %s', (_case, amountMinor, fractionDigits, expected) => {
    const apple = buildWalletData('applepay', { currencyCode: 'EUR', amountMinor, fractionDigits });
    const google = buildWalletData('googlepay', { currencyCode: 'EUR', amountMinor, fractionDigits });

    expect((apple?.payload as { total: { amount: string } }).total.amount).toBe(expected);
    expect((google?.payload as { transactionInfo: { totalPrice: string } }).transactionInfo.totalPrice).toBe(expected);
  });
});

// Every other method needs no sheet, and the absence is what keeps the shopper config carrying a wallet block
// only where one means something.
describe('buildWalletData — a method that is no wallet', () => {
  it.each(['card', 'paylater-installment'])('answers nothing for %s', (code) => {
    expect(buildWalletData(code, purchase)).toBeUndefined();
  });
});

/**
 * The card networks come from the VENDOR: the keypair reports brands in its own spelling and each
 * wallet sheet takes its own, so the brands are mapped per surface - and a brand a sheet does not accept is
 * dropped rather than sent for it to refuse.
 */
describe('toSurfaceCardNetworks', () => {
  it('maps the vendor brands to Google Pay spelling', () => {
    expect(toSurfaceCardNetworks('googlepay', ['MASTER', 'VISA', 'AMEX'])).toEqual(['MASTERCARD', 'VISA', 'AMEX']);
  });

  it('maps the vendor brands to Apple Pay spelling', () => {
    expect(toSurfaceCardNetworks('applepay', ['MASTER', 'VISA', 'MAESTRO'])).toEqual(['masterCard', 'visa', 'maestro']);
  });

  it.each([
    ['a brand Google Pay does not offer', 'googlepay', ['DINERS', 'MASTER'], ['MASTERCARD']],
    ['a brand Apple Pay does not offer', 'applepay', ['INTERAC', 'VISA'], ['visa']],
    ['a duplicate brand', 'googlepay', ['MASTER', 'MASTERCARD'], ['MASTERCARD']],
    ['an unknown brand', 'googlepay', ['BITCOIN'], []],
  ])('drops %s', (_case, code, brands, expected) => {
    expect(toSurfaceCardNetworks(code, brands)).toEqual(expected);
  });

  it('answers nothing for a method that is no wallet', () => {
    expect(toSurfaceCardNetworks('card', ['VISA'])).toEqual([]);
  });
});

// PRECEDENCE for the sheet's networks: the merchant's choice, then the vendor's own brands, and NOTHING
// after that - so a sheet never offers a network the account cannot be charged on.
describe('buildWalletData — the card networks', () => {
  const purchase = { currencyCode: 'EUR', amountMinor: 1999, fractionDigits: 2 };

  it('uses the vendor networks when the merchant configured none', () => {
    const google = buildWalletData('googlepay', { ...purchase, cardNetworks: ['VISA'] });
    const apple = buildWalletData('applepay', { ...purchase, cardNetworks: ['visa'] });

    expect((google?.payload as { allowedCardNetworks: string[] }).allowedCardNetworks).toEqual(['VISA']);
    expect((apple?.payload as { supportedNetworks: string[] }).supportedNetworks).toEqual(['visa']);
  });

  it('prefers the merchant choice over the vendor networks', () => {
    const google = buildWalletData('googlepay', {
      ...purchase,
      cardNetworks: ['VISA', 'MASTERCARD'],
      googlePay: { allowedCardNetworks: ['MASTERCARD'] },
    });

    expect((google?.payload as { allowedCardNetworks: string[] }).allowedCardNetworks).toEqual(['MASTERCARD']);
  });

  /**
   * NOTHING is invented when the vendor reports no brand: the sheet offers none. A hardcoded pair would put
   * a network in front of the shopper that the account may not be able to charge, and the refusal would come
   * after the sheet was authorised - the one moment a shopper reads as "the payment worked".
   */
  it('offers no network at all when neither the merchant nor the vendor named one', () => {
    const google = buildWalletData('googlepay', purchase);
    const apple = buildWalletData('applepay', purchase);

    expect((google?.payload as { allowedCardNetworks: string[] }).allowedCardNetworks).toEqual([]);
    expect((apple?.payload as { supportedNetworks: string[] }).supportedNetworks).toEqual([]);
  });
});

/**
 * Google's button renders its OWN label, so the language matters - and it is NOT configurable: it always follows
 * the SHOPPER, i.e. the session cart's locale reduced to its primary subtag. A language Google does not render is
 * dropped rather than sent for it to refuse (`ButtonOptions.buttonLocale`).
 */
describe('buildWalletData — the button language', () => {
  const purchase = { currencyCode: 'EUR', amountMinor: 1999, fractionDigits: 2 };
  const buttonOptions = (over: Record<string, unknown>) =>
    (buildWalletData('googlepay', { ...purchase, ...over })?.payload as { buttonOptions: Record<string, unknown> })
      .buttonOptions;

  it.each([
    ['the cart locale', { locale: 'de-DE' }, 'de'],
    ['a bare language tag', { locale: 'fr' }, 'fr'],
  ])('follows %s', (_case, over, expected) => {
    expect(buttonOptions(over).buttonLocale).toBe(expected);
  });

  it.each([
    ['a language Google does not render', { locale: 'sq-AL' }],
    ['no locale at all', {}],
  ])('omits the language for %s', (_case, over) => {
    expect(buttonOptions(over)).not.toHaveProperty('buttonLocale');
  });
});
