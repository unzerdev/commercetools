/**
 * `PaymentMethodsRequestSchema` boundary bounds (Sec2): a merchant PUT is range-validated at the
 * transport gate BEFORE the orchestrator. Money amounts (`surcharge`, `minAmount`, `maxAmount`) are
 * CURRENCY-KEYED maps of non-negative integers - ISO-4217 alpha-3 keys (`^[A-Z]{3}$`), minor units -
 * and each `countries` entry is an ISO-3166 alpha-2 code (`^[A-Z]{2}$`). A value outside these bounds
 * fails schema validation (a 400) and never reaches persistence, and so does a body carrying the
 * legacy scalar amount shape.
 */
import { describe, expect, it } from '@jest/globals';
import { Value } from '@sinclair/typebox/value';
import {
  PaymentMethodsRequestSchema,
  PaymentMethodsViewResponseSchema,
} from '../src/infrastructure/http/dtos/mc/payment-methods.dto';

/** A fully-valid method config the individual assertions mutate one field at a time. */
const method = (overrides: Record<string, unknown> = {}) => ({
  paymentMethodCode: 'card',
  enabled: true,
  name: { en: 'Card' },
  description: { en: 'Pay by card' },
  surcharge: { EUR: 0 },
  countries: ['DE'],
  sendBasketData: false,
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({ paymentMethods: [method(overrides)] });

describe('PaymentMethodsRequestSchema - money and country bounds', () => {
  it('accepts a well-formed method', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body())).toBe(true);
  });

  it('rejects a negative surcharge (minimum 0)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ surcharge: { EUR: -1 } }))).toBe(false);
  });

  it('rejects a negative minAmount / maxAmount (minimum 0)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ minAmount: { EUR: -1 } }))).toBe(false);
    expect(Value.Check(PaymentMethodsRequestSchema, body({ maxAmount: { EUR: -1 } }))).toBe(false);
  });

  it('accepts a zero surcharge and zero amounts', () => {
    expect(
      Value.Check(
        PaymentMethodsRequestSchema,
        body({ surcharge: { EUR: 0 }, minAmount: { EUR: 0 }, maxAmount: { EUR: 0 } }),
      ),
    ).toBe(true);
  });

  it('accepts several currencies per amount and an empty map (nothing configured)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ minAmount: { EUR: 500, USD: 600 }, surcharge: {} }))).toBe(
      true,
    );
  });

  it('rejects a currency key that is not ISO-4217 alpha-3', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ surcharge: { eur: 0 } }))).toBe(false); // lowercase
    expect(Value.Check(PaymentMethodsRequestSchema, body({ surcharge: { EURO: 0 } }))).toBe(false); // 4-letter
    expect(Value.Check(PaymentMethodsRequestSchema, body({ minAmount: { EU1: 0 } }))).toBe(false); // digit
  });

  it('rejects a non-integer amount (minor units are integers)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ minAmount: { EUR: 5.5 } }))).toBe(false);
  });

  it('rejects the legacy scalar amount shape (no backward-compatibility shim)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ surcharge: 0 }))).toBe(false);
    expect(Value.Check(PaymentMethodsRequestSchema, body({ minAmount: 500 }))).toBe(false);
    expect(Value.Check(PaymentMethodsRequestSchema, body({ maxAmount: 500 }))).toBe(false);
  });

  it('rejects a method missing the required surcharge map', () => {
    const withoutSurcharge = method();
    delete (withoutSurcharge as Record<string, unknown>).surcharge;
    expect(Value.Check(PaymentMethodsRequestSchema, { paymentMethods: [withoutSurcharge] })).toBe(false);
  });

  it('rejects a country code that is not ISO-3166 alpha-2', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: ['de'] }))).toBe(false); // lowercase
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: ['DEU'] }))).toBe(false); // 3-letter
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: ['D1'] }))).toBe(false); // digit
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: ['germany'] }))).toBe(false);
  });

  it('accepts a valid uppercase alpha-2 country list and an empty list (all supported)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: ['DE', 'AT'] }))).toBe(true);
    expect(Value.Check(PaymentMethodsRequestSchema, body({ countries: [] }))).toBe(true);
  });
});

describe('PaymentMethodsRequestSchema - sendBasketData and the read-only supportsAuthorize', () => {
  it('accepts sendBasketData true or false (a required boolean)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ sendBasketData: true }))).toBe(true);
    expect(Value.Check(PaymentMethodsRequestSchema, body({ sendBasketData: false }))).toBe(true);
  });

  it('rejects a method missing the required sendBasketData', () => {
    const withoutSendBasketData = method();
    delete (withoutSendBasketData as Record<string, unknown>).sendBasketData;
    expect(Value.Check(PaymentMethodsRequestSchema, { paymentMethods: [withoutSendBasketData] })).toBe(false);
  });

  it('rejects a non-boolean sendBasketData', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ sendBasketData: 'yes' }))).toBe(false);
  });

  it('rejects a PUT body carrying the read-only supportsAuthorize (strict, so it can never persist)', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, body({ supportsAuthorize: true }))).toBe(false);
  });
});

describe('PaymentMethodsViewResponseSchema - the GET view carries the derived capabilities and coverage', () => {
  const viewMethod = (overrides: Record<string, unknown> = {}) =>
    method({
      supportsAuthorize: true,
      supportsCharge: true,
      vendorCountries: ['DE'],
      vendorCurrencies: ['EUR'],
      vendorCustomerTypes: ['B2C'],
      vendorCardNetworks: [],
      ...overrides,
    });

  it('accepts a method that carries the read-only capabilities and the vendor coverage', () => {
    expect(Value.Check(PaymentMethodsViewResponseSchema, { paymentMethods: [viewMethod()] })).toBe(true);
  });

  it('rejects a view method missing the derived members (the GET always resolves them)', () => {
    expect(Value.Check(PaymentMethodsViewResponseSchema, body())).toBe(false);
    expect(
      Value.Check(PaymentMethodsViewResponseSchema, { paymentMethods: [viewMethod({ supportsCharge: undefined })] }),
    ).toBe(false);
  });
});
/**
 * The WALLET blocks: each method may carry its own, and each is STRICT - an unknown sub-key is a typo
 * or a drifted client, and both are better refused at the gate than persisted forever.
 */
describe('PaymentMethodsRequestSchema - the wallet blocks', () => {
  const walletMethod = (over: Record<string, unknown>) => ({
    paymentMethodCode: 'googlepay',
    enabled: true,
    name: {},
    description: {},
    surcharge: {},
    countries: [],
    sendBasketData: true,
    ...over,
  });
  const check = (over: Record<string, unknown>) =>
    Value.Check(PaymentMethodsRequestSchema, { paymentMethods: [walletMethod(over)] });

  it('accepts a fully configured Google Pay block', () => {
    expect(
      check({
        googlePay: {
          merchantId: '12345678901234567890',
          merchantName: 'Unzer Demo Shop',
          countryCode: 'CH',
          allowedCardNetworks: ['VISA'],
          allowCreditCards: false,
          allowPrepaidCards: true,
          buttonColor: 'black',
          buttonSizeMode: 'static',
        },
      }),
    ).toBe(true);
  });

  it('accepts an Apple Pay block', () => {
    expect(check({ applePay: { supportedNetworks: ['visa'], label: 'Unzer Demo Shop' } })).toBe(true);
  });

  it('accepts a method carrying neither block', () => {
    expect(check({})).toBe(true);
  });

  it.each([
    ['an unknown Google sub-key', { googlePay: { buttonShape: 'pill' } }],
    // The vendor's JS does not read a corner radius, so the connector offers no such field.
    ['the withdrawn button radius', { googlePay: { buttonRadius: 4 } }],
    ['a button type Google does not define', { googlePay: { buttonType: 'gift' } }],
    // The button's language always follows the cart, so there is no field to send.
    ['the withdrawn button locale', { googlePay: { buttonLocale: 'de' } }],
    ['an unknown Apple sub-key', { applePay: { merchantCapabilities: ['supports3DS'] } }],
    ['a country the vendor does not serve', { googlePay: { countryCode: 'DE' } }],
    // The networks are the VENDOR's, so the gate validates shape and not membership.
    ['an empty network name', { googlePay: { allowedCardNetworks: [''] } }],
    ['a non-string network', { googlePay: { allowedCardNetworks: [1] } }],
    ['a button colour that is not one of the three', { googlePay: { buttonColor: 'blue' } }],
    ['an Apple network that is not a string', { applePay: { supportedNetworks: [null] } }],
  ])('rejects %s', (_case, over) => {
    expect(check(over)).toBe(false);
  });
});
