import { describe, expect, it } from '@jest/globals';
import { parsePaymentConfig } from '../src/payment-enabler/payment-config';

describe('parsePaymentConfig', () => {
  it('parses the processor payment-config body into the shopper-safe shape', () => {
    const body = {
      publicKey: 's-pub-abc',
      environment: 'sandbox',
      locale: 'en-GB',
      currency: 'EUR',
      fractionDigits: 2,
      paymentMethods: [
        { code: 'card', name: 'Credit card', description: 'Pay by card', surcharge: 0, requiresCustomerData: false },
        {
          code: 'paylater-invoice',
          name: 'Invoice',
          description: 'Pay later',
          surcharge: 199,
          logo: 'https://cdn/inv.png',
          requiresCustomerData: true,
        },
      ],
    };

    const config = parsePaymentConfig(body);

    expect(config).toEqual({
      publicKey: 's-pub-abc',
      environment: 'sandbox',
      locale: 'en-GB',
      currency: 'EUR',
      fractionDigits: 2,
      amount: 0,
      customerType: 'B2C',
      paymentMethods: [
        {
          code: 'card',
          name: 'Credit card',
          description: 'Pay by card',
          surcharge: 0,
          requiresCustomerData: false,
          needsAmountData: false,
          rendersOwnPayButton: false,
        },
        {
          code: 'paylater-invoice',
          name: 'Invoice',
          description: 'Pay later',
          surcharge: 199,
          logo: 'https://cdn/inv.png',
          requiresCustomerData: true,
          needsAmountData: false,
          rendersOwnPayButton: false,
        },
      ],
    });
  });

  it('reads currency and fractionDigits from the body', () => {
    const config = parsePaymentConfig({ currency: 'EUR', fractionDigits: 2 });
    expect(config.currency).toBe('EUR');
    expect(config.fractionDigits).toBe(2);
  });

  it('never surfaces a private-key-shaped field even if the body carries one', () => {
    const config = parsePaymentConfig({ publicKey: 's-pub-abc', privateKey: 's-priv-SECRET' });
    expect(JSON.stringify(config)).not.toMatch(/priv|secret/i);
  });

  it('fail-softs a sparse body to empty defaults', () => {
    const config = parsePaymentConfig({});
    expect(config).toEqual({
      publicKey: '',
      environment: '',
      locale: '',
      currency: '',
      fractionDigits: 2,
      amount: 0,
      customerType: 'B2C',
      paymentMethods: [],
    });
  });

  /**
   * The CART AMOUNT is carried again: the vendor element is handed it through its own `setBasketData`
   * so an instalment surface can draw its plans. It is the cart total WITHOUT any surcharge - what is CHARGED
   * stays the processor's alone (P4). The SHOPPER block prefills the vendor customer form.
   */
  it('carries the cart amount, the purchase country and the shopper prefill', () => {
    const config = parsePaymentConfig({
      amount: 93714,
      country: 'DE',
      shopper: { firstName: 'Peter', dateOfBirth: '19861212' },
    });

    expect(config.amount).toBe(93714);
    expect(config.country).toBe('DE');
    expect(config.shopper).toEqual({ firstName: 'Peter', dateOfBirth: '19861212' });
  });

  // Fail-soft like every other amount in this parser: a body without one, or with nonsense in it, yields 0 -
  // and 0 means "nothing to push", not "a free cart".
  it.each([
    ['a missing amount', {}, 0],
    ['a negative amount', { amount: -5 }, 0],
    ['a non-numeric amount', { amount: '93714' }, 0],
    ['a fractional amount', { amount: 93714.7 }, 93714],
  ])('normalizes %s', (_case, body, expected) => {
    expect(parsePaymentConfig(body).amount).toBe(expected);
  });

  // A shopper block the processor did not send, or one with nothing usable in it, is ABSENT rather than an
  // object of empty strings: the vendor form would read an empty string as an answer and stop asking.
  it.each([
    ['no shopper block', {}],
    ['an empty shopper block', { shopper: {} }],
    ['a shopper block of blanks', { shopper: { firstName: '', email: '' } }],
    ['a non-object shopper', { shopper: 'Peter' }],
  ])('reports no shopper for %s', (_case, body) => {
    expect(parsePaymentConfig(body).shopper).toBeUndefined();
  });

  it('keeps only the prefill leaves it understands, dropping anything else the body carries', () => {
    const config = parsePaymentConfig({
      shopper: {
        firstName: 'Peter',
        salutation: 'dr',
        customerId: 'ct-cust-9',
        billingAddress: { street: 'Hauptstr', postalCode: '69115', privateKey: 's-priv-leak' },
      },
    });

    expect(config.shopper).toEqual({
      firstName: 'Peter',
      billingAddress: { street: 'Hauptstr', postalCode: '69115' },
    });
  });

  /**
   * WHO is buying, as the processor resolved it. Fail-soft to the PRIVATE kind: a processor that said
   * nothing must not turn the purchase into a business one, which is a different vendor form and a narrower
   * method list.
   */
  it.each([
    ['B2B when the processor says so', { customerType: 'B2B' }, 'B2B'],
    ['B2C when it says that', { customerType: 'B2C' }, 'B2C'],
    ['B2C when it says nothing', {}, 'B2C'],
    ['B2C for a value that is neither', { customerType: 'business' }, 'B2C'],
  ])('reads the customer type: %s', (_case, body, expected) => {
    expect(parsePaymentConfig(body).customerType).toBe(expected);
  });

  /**
   * The WALLET block: passed through only when this build can act on it - a known `kind` naming a
   * setter it can call, and an object payload. Anything else is drift, and dropping it leaves a payable surface
   * rather than a mount that throws.
   */
  it('carries a wallet block for a known kind and drops anything else', () => {
    const config = parsePaymentConfig({
      paymentMethods: [
        { code: 'googlepay', rendersOwnPayButton: true, wallet: { kind: 'googlepay', payload: { a: 1 } } },
        { code: 'applepay', wallet: { kind: 'applepay', payload: {} } },
        { code: 'wechatpay', wallet: { kind: 'wechatpay', payload: {} } },
        { code: 'card', wallet: { kind: 'googlepay', payload: 'not-an-object' } },
        { code: 'ideal', wallet: 'nonsense' },
      ],
    });

    expect(config.paymentMethods.map((m) => [m.code, m.wallet?.kind, m.rendersOwnPayButton])).toEqual([
      ['googlepay', 'googlepay', true],
      ['applepay', 'applepay', false],
      ['wechatpay', undefined, false],
      ['card', undefined, false],
      ['ideal', undefined, false],
    ]);
  });

  // The surface's own figures flag: read as a strict `true`, so a processor that predates the field
  // pushes nothing - which is what this surface did before the field existed.
  it('reads the per-method amount-data flag as a strict boolean', () => {
    const config = parsePaymentConfig({
      paymentMethods: [
        { code: 'paylater-installment', needsAmountData: true },
        { code: 'ideal', needsAmountData: 'yes' },
        { code: 'eps' },
      ],
    });

    expect(config.paymentMethods.map((m) => [m.code, m.needsAmountData])).toEqual([
      ['paylater-installment', true],
      ['ideal', false],
      ['eps', false],
    ]);
  });

  it('normalizes a malformed method and a non-integer/negative surcharge to a well-formed view', () => {
    const config = parsePaymentConfig({
      paymentMethods: [
        { code: 'card' },
        { code: 'ideal', name: 'iDEAL', description: 'Bank', surcharge: -5 },
        { code: 'EPS', name: 'EPS', description: 'EPS', surcharge: 12.9, requiresCustomerData: true },
      ],
    });
    expect(config.paymentMethods).toEqual([
      {
        code: 'card',
        name: '',
        description: '',
        surcharge: 0,
        requiresCustomerData: false,
        needsAmountData: false,
        rendersOwnPayButton: false,
      },
      {
        code: 'ideal',
        name: 'iDEAL',
        description: 'Bank',
        surcharge: 0,
        requiresCustomerData: false,
        needsAmountData: false,
        rendersOwnPayButton: false,
      },
      {
        code: 'EPS',
        name: 'EPS',
        description: 'EPS',
        surcharge: 12,
        requiresCustomerData: true,
        needsAmountData: false,
        rendersOwnPayButton: false,
      },
    ]);
  });
});
