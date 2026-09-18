import { describe, expect, it } from '@jest/globals';
import {
  carriesClickToPay,
  defaultBookingMode,
  inDisplayOrder,
  isMergedMethod,
  isOfferableMethod,
  METHOD_DISPLAY_ORDER,
  METHOD_TRANSACTION_SUPPORT,
  needsAmountData,
  OFFERABLE_METHOD_CODES,
  resolveBookingMode,
  showsTransferInstructions,
  supportsCharge,
  supportsTwoStep,
  surfaceTraits,
} from '../src/providers/psp/methods';

/**
 * The per-method TRANSACTION support table: for each keypair method-type code, whether Unzer accepts an
 * Authorize, whether it accepts a direct Charge, and which of the two this connector books by default. Two independent sources fill it: the vendor's published per-method booking behaviour
 * (`can_authorize` + `order_payment_action` per method) and a probe of the live sandbox account, which
 * agree on every code the probe could exercise.
 */
/**
 * `needsAmountData` - which SURFACE needs the purchase's figures (amount, currency, country) before it can be
 * paid with. The instalment surface alone: it fetches a plan list from the vendor on mount, and the vendor
 * refuses that fetch without them. Handing the figures to any other method would state the amount
 * twice, and the server is the one authority on what is charged.
 */
/**
 * `showsTransferInstructions` - whose answer ends in an ACCOUNT the shopper must transfer to.
 * PREPAYMENT alone for now: the vendor's `processing` block carries an iban on other methods too (the SEPA
 * mandate's own), so the panel is gated per method rather than on the data.
 */
/**
 * The four surface traits are answered TOGETHER, by one call: the shopper config carries them per method,
 * and four independent getters let a surface receive three of them and silently miss the fourth.
 */
describe('surfaceTraits - the four static facts a checkout surface needs per method', () => {
  it('describes the card: no payer data, no figures, its own button no, Click to Pay yes', () => {
    expect(surfaceTraits('card')).toEqual({
      requiresCustomerData: false,
      needsAmountData: false,
      rendersOwnPayButton: false,
      carriesClickToPay: true,
    });
  });

  it('describes the instalment: a described payer AND the purchase figures its plan list needs', () => {
    expect(surfaceTraits('paylater-installment')).toEqual({
      requiresCustomerData: true,
      needsAmountData: true,
      rendersOwnPayButton: false,
      carriesClickToPay: false,
    });
  });

  it('describes a wallet: its own platform button, and nothing else', () => {
    expect(surfaceTraits('googlepay')).toEqual({
      requiresCustomerData: false,
      needsAmountData: false,
      rendersOwnPayButton: true,
      carriesClickToPay: false,
    });
  });

  it('answers for a code this release never implemented, without offering it', () => {
    expect(surfaceTraits('giropay')).toEqual({
      requiresCustomerData: false,
      needsAmountData: false,
      rendersOwnPayButton: false,
      carriesClickToPay: false,
    });
    expect(isOfferableMethod('giropay')).toBe(false);
  });
});

describe('showsTransferInstructions', () => {
  it('is true for prepayment', () => {
    expect(showsTransferInstructions('prepayment')).toBe(true);
  });

  it.each(['sepa-direct-debit', 'paylater-direct-debit', 'paylater-invoice', 'card', 'klarna'])(
    'is false for %s',
    (code) => {
      expect(showsTransferInstructions(code)).toBe(false);
    },
  );
});

describe('needsAmountData', () => {
  it('is true for the instalment surface', () => {
    expect(needsAmountData('paylater-installment')).toBe(true);
  });

  it.each(['card', 'paylater-invoice', 'paylater-direct-debit', 'klarna', 'paypal', 'googlepay'])(
    'is false for %s',
    (code) => {
      expect(needsAmountData(code)).toBe(false);
    },
  );
});

describe('the per-method transaction support table', () => {
  it('reports the authorize-only methods as refusing a direct charge', () => {
    // Measured: `POST /v1/payments/charges` on a Klarna type answers 500 API.000.000.999, while
    // `POST /v1/payments/authorize` with the same body succeeds.
    for (const code of ['klarna', 'paylater-invoice', 'paylater-installment', 'paylater-direct-debit']) {
      expect(supportsTwoStep(code)).toBe(true);
      expect(supportsCharge(code)).toBe(false);
    }
  });

  it('reports the charge-only methods as refusing an authorization', () => {
    // Measured: `POST /v1/payments/authorize` answers 405 API.320.000.004 for each of these.
    for (const code of [
      'alipay',
      'bancontact',
      'ideal',
      'openbanking-pis',
      'payu',
      'post-finance-efinance',
      'prepayment',
      'przelewy24',
      'twint',
      'wechatpay',
      'EPS',
      'sepa-direct-debit',
    ]) {
      expect(supportsTwoStep(code)).toBe(false);
      expect(supportsCharge(code)).toBe(true);
    }
  });

  it('reports the methods that accept both kinds', () => {
    for (const code of ['card', 'paypal', 'applepay', 'googlepay', 'wero']) {
      expect(supportsTwoStep(code)).toBe(true);
      expect(supportsCharge(code)).toBe(true);
    }
  });

  // The default follows the reference's `order_payment_action` per method: `authorize` for cards, PayPal,
  // Wero and the paylater family, `authorize_capture` (a charge) for the wallets.
  it('takes the default booking mode from the reference integration, per method', () => {
    expect(defaultBookingMode('card')).toBe('authorize');
    expect(defaultBookingMode('paypal')).toBe('authorize');
    expect(defaultBookingMode('wero')).toBe('authorize');
    expect(defaultBookingMode('applepay')).toBe('charge');
    expect(defaultBookingMode('googlepay')).toBe('charge');
    expect(defaultBookingMode('klarna')).toBe('authorize');
    expect(defaultBookingMode('ideal')).toBe('charge');
  });

  // A code the table does not know is read CONSERVATIVELY as charge-only: charge is the kind every method
  // this account holds accepts except the paylater family, and offering a booking-mode choice the vendor
  // then refuses would fail at the shopper's checkout rather than in configuration.
  it('reads an unknown code as charge-only with no booking-mode choice', () => {
    expect(supportsTwoStep('a-method-added-after-this-release')).toBe(false);
    expect(supportsCharge('a-method-added-after-this-release')).toBe(true);
    expect(defaultBookingMode('a-method-added-after-this-release')).toBe('charge');
  });

  it('states a possible default and at least one possible kind for every code in the table', () => {
    for (const [code, support] of Object.entries(METHOD_TRANSACTION_SUPPORT)) {
      expect(support.authorize || support.charge).toBe(true);
      expect(supportsTwoStep(code)).toBe(support.authorize);
      expect(supportsCharge(code)).toBe(support.charge);
      // The default must be a kind the method actually supports, else it names an impossible transaction.
      expect(support.default === 'authorize' ? support.authorize : support.charge).toBe(true);
    }
  });
});

/**
 * `resolveBookingMode` is what the charge path actually books. A method with only ONE possible kind uses
 * it whatever the merchant configured — a stored choice cannot make the vendor accept a transaction it
 * refuses, and honouring it would refuse the payment instead (Klarna answered 500 API.000.000.999 that
 * way). A method that accepts both honours the merchant's choice, falling back to the per-method default.
 */
describe('resolveBookingMode — the kind the charge path books', () => {
  it('forces authorize for an authorize-only method, whatever the config says', () => {
    expect(resolveBookingMode('klarna', undefined)).toBe('authorize');
    expect(resolveBookingMode('klarna', 'charge')).toBe('authorize');
    expect(resolveBookingMode('paylater-invoice', 'charge')).toBe('authorize');
  });

  it('forces charge for a charge-only method, whatever the config says', () => {
    expect(resolveBookingMode('ideal', undefined)).toBe('charge');
    expect(resolveBookingMode('ideal', 'authorize')).toBe('charge');
    expect(resolveBookingMode('prepayment', 'authorize')).toBe('charge');
  });

  it('honours the merchant choice for a method that accepts both', () => {
    expect(resolveBookingMode('card', 'charge')).toBe('charge');
    expect(resolveBookingMode('card', 'authorize')).toBe('authorize');
    expect(resolveBookingMode('applepay', 'authorize')).toBe('authorize');
  });

  it('falls back to the per-method default when the merchant chose nothing', () => {
    expect(resolveBookingMode('card', undefined)).toBe('authorize');
    expect(resolveBookingMode('applepay', undefined)).toBe('charge');
  });

  it('reads an unknown code as charge', () => {
    expect(resolveBookingMode('a-method-added-after-this-release', 'authorize')).toBe('charge');
  });
});

/**
 * Click to Pay is a second affordance on the card payment type, not a method a shopper picks instead of a
 * card, so the catalogue boundary drops it. The match is normalized because the vendor's
 * spelling of this one code is not something to depend on.
 */
describe('isMergedMethod — the codes that ride on another method', () => {
  it('matches every spelling of Click to Pay', () => {
    for (const spelling of ['clicktopay', 'click-to-pay', 'Click To Pay', 'CLICK_TO_PAY', 'ClickToPay']) {
      expect(isMergedMethod(spelling)).toBe(true);
    }
  });

  it('leaves every other method a method of its own', () => {
    for (const code of Object.keys(METHOD_TRANSACTION_SUPPORT).filter((c) => c !== 'clicktopay')) {
      expect(isMergedMethod(code)).toBe(false);
    }
    expect(isMergedMethod('a-method-added-after-this-release')).toBe(false);
  });
});

/**
 * The other half of that rule: dropping the `clicktopay` row only makes sense because the affordance is
 * carried by the CARD surface — Unzer draws Click to Pay inside the card element's own iframe.
 */
describe('carriesClickToPay — the surface Click to Pay rides on', () => {
  it('is the card, whatever the case the vendor spells it in', () => {
    expect(carriesClickToPay('card')).toBe(true);
    expect(carriesClickToPay('CARD')).toBe(true);
  });

  it('is no other method', () => {
    for (const code of Object.keys(METHOD_TRANSACTION_SUPPORT).filter((c) => c !== 'card')) {
      expect(carriesClickToPay(code)).toBe(false);
    }
    expect(carriesClickToPay('a-method-added-after-this-release')).toBe(false);
  });
});

/**
 * What the catalogue boundary filters on. An account may serve types this release never
 * implemented, and offering one puts a method on the merchant's screen that the enabler cannot mount —
 * `Component type not supported` at the shopper's checkout, on a method the merchant switched on.
 */
describe('isOfferableMethod — what the connector can actually offer', () => {
  it('offers every code the table declares a surface for', () => {
    for (const code of ['card', 'paypal', 'payu', 'przelewy24', 'klarna', 'EPS']) {
      expect(isOfferableMethod(code)).toBe(true);
    }
  });

  // The account serves them; this release never implemented them. Knowing the code is the connector's job.
  it('refuses a type this release does not implement', () => {
    for (const code of ['giropay', 'sofort', 'a-type-added-after-this-release']) {
      expect(isOfferableMethod(code)).toBe(false);
    }
  });

  // Known, real capabilities, no surface — the retired `-secured` pair. Both PostFinance codes used to sit
  // here on the belief that the vendor shipped no v2 element for them; it does, so both are offered now.
  it('refuses a known code the connector renders no surface for', () => {
    for (const code of ['installment-secured', 'invoice-secured']) {
      expect(METHOD_TRANSACTION_SUPPORT[code]).toBeDefined();
      expect(isOfferableMethod(code)).toBe(false);
    }
  });

  it('refuses the merged code, which rides on the card instead', () => {
    expect(isOfferableMethod('clicktopay')).toBe(false);
  });

  it('lists exactly the offerable codes', () => {
    expect([...OFFERABLE_METHOD_CODES].sort()).toEqual(
      Object.keys(METHOD_TRANSACTION_SUPPORT).filter(isOfferableMethod).sort(),
    );
    expect(OFFERABLE_METHOD_CODES).not.toContain('clicktopay');
  });
});

/**
 * The order every method list renders in. It is merchandising, not derivation, so the only thing
 * a spec can do is pin the contract AROUND it: total coverage of the catalogue, and a stable sort.
 */
describe('METHOD_DISPLAY_ORDER', () => {
  // The guard that matters: a code added to the table without a position would silently sort LAST, which
  // is a merchandising decision nobody made.
  it('places every catalogue code exactly once, and nothing else', () => {
    const table = Object.keys(METHOD_TRANSACTION_SUPPORT);

    expect([...METHOD_DISPLAY_ORDER].sort()).toEqual([...table].sort());
    expect(new Set(METHOD_DISPLAY_ORDER).size).toBe(METHOD_DISPLAY_ORDER.length);
  });

  it('opens on the Unzer-branded pay-later family and closes on the wallets the vendor lists last', () => {
    expect(METHOD_DISPLAY_ORDER.slice(0, 4)).toEqual([
      'paylater-invoice',
      'paylater-installment',
      'paylater-direct-debit',
      'openbanking-pis',
    ]);
    expect(METHOD_DISPLAY_ORDER.slice(-3)).toEqual(['paypal', 'alipay', 'wechatpay']);
  });

  it('sorts a catalogue into that order, whatever order it arrived in', () => {
    const arrived = [{ code: 'wechatpay' }, { code: 'card' }, { code: 'paylater-invoice' }, { code: 'applepay' }];

    expect(inDisplayOrder(arrived).map((entry) => entry.code)).toEqual([
      'paylater-invoice',
      'card',
      'applepay',
      'wechatpay',
    ]);
  });

  // An unplaced code sorts LAST rather than away: ordering must not become a second offerability filter.
  it('puts an unplaced code last and keeps the arrival order among such codes', () => {
    const arrived = [{ code: 'zzz-new' }, { code: 'aaa-new' }, { code: 'card' }];

    expect(inDisplayOrder(arrived).map((entry) => entry.code)).toEqual(['card', 'zzz-new', 'aaa-new']);
  });

  it('leaves the offerable list in display order', () => {
    expect(OFFERABLE_METHOD_CODES).toEqual(METHOD_DISPLAY_ORDER.filter(isOfferableMethod));
    expect(OFFERABLE_METHOD_CODES[0]).toBe('paylater-invoice');
  });
});
