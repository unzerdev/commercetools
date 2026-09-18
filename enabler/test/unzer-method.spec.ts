import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnzerMethodBuilder, UnzerMethodComponent } from '../src/components/unzer/unzer-method';
import { PaymentConfig, PaymentMethodView } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';
import type { ComponentOptions } from '../src/payment-enabler/payment-enabler';
import {
  FetchMock,
  flushPromises,
  installFetchMock,
  installLocationMock,
  makeBaseOptions,
  okJson,
  readCall,
} from './helpers';

/**
 * The `<unzer-payment>` stand-in. The real SDK defines `setBasketData` and `setCustomerData` on the element's
 * prototype; this stub offers both and records every push, which is how the specs pin WHAT the component hands
 * the vendor: the customer for every method, and the cart amount only for a method the merchant asked
 * basket data for.
 */
class UnzerPaymentStub extends HTMLElement {
  basketData: Array<{ amount: number; currencyType: string; country?: string }> = [];
  /** What the component prefilled through the FIELD-BY-FIELD setter — the one it must use. */
  customerData: Array<Record<string, unknown>> = [];
  /** What it prefilled through the full API loader, which recomputes field visibility and must be avoided. */
  loadedCustomerData: Array<Record<string, unknown>> = [];

  /** What the component pushed into each WALLET setter - the payload it must pass on verbatim. */
  applePayData: Array<Record<string, unknown>> = [];
  googlePayData: Array<Record<string, unknown>> = [];

  setApplePayData(data: Record<string, unknown>): void {
    this.applePayData.push(data);
  }

  setGooglePayData(data: Record<string, unknown>): void {
    this.googlePayData.push(data);
  }

  setBasketData(data: { amount: number; currencyType: string; country?: string }): void {
    this.basketData.push(data);
  }

  updateCustomerData(data: Record<string, unknown>): void {
    this.customerData.push(data);
  }

  setCustomerData(data: Record<string, unknown>): void {
    this.loadedCustomerData.push(data);
  }
}

/**
 * The `<unzer-checkout>` stand-in. The real element submits when the button that is its CHILD is clicked and
 * reports the outcome through `onPaymentSubmit`; the component keeps that button hidden and clicks it from
 * `submit()`. The stub does the same on a click of an enabled `[data-unzer-submit]`, answering with
 * `nextResult` (`null` = the vendor never reports) and telling `onClick` that the click happened.
 */
class UnzerCheckoutStub extends HTMLElement {
  static nextResult: SubmitResult | null = { submitResponse: { success: true, data: { id: 'unzer-type-1' } } };
  static onClick: (() => void) | undefined;
  onPaymentSubmit?: (result: SubmitResult) => void;

  connectedCallback(): void {
    this.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || target.disabled || !target.hasAttribute('data-unzer-submit')) {
        return;
      }
      UnzerCheckoutStub.onClick?.();
      const result = UnzerCheckoutStub.nextResult;
      if (result) {
        queueMicrotask(() => this.onPaymentSubmit?.(result));
      }
    });
  }
}

// The Unzer SDK registers these custom elements; register stand-ins so `customElements.whenDefined(tag)`
// resolves and both `<unzer-payment>` and `<unzer-checkout>` are real elements to drive.
const defineUnzerElements = () => {
  if (!customElements.get('unzer-payment')) {
    customElements.define('unzer-payment', UnzerPaymentStub);
  }
  if (!customElements.get('unzer-checkout')) {
    customElements.define('unzer-checkout', UnzerCheckoutStub);
  }
  // Every tag any case in this file mounts. A missing one is not a soft failure: `mount` waits for the
  // definition (a real element self-renders only once registered), so an undefined tag hangs the case
  // until the SDK budget expires - which is what the wallet cases did while this list named neither.
  for (const tag of [
    'unzer-card',
    'unzer-paylater-invoice',
    'unzer-paylater-installment',
    'unzer-customer-form',
    'unzer-apple-pay',
    'unzer-google-pay',
    'unzer-bancontact',
  ]) {
    if (!customElements.get(tag)) {
      customElements.define(tag, class extends HTMLElement {});
    }
  }
};

const cardMethod: PaymentMethodView = {
  code: 'card',
  name: 'Credit card',
  description: 'Pay by card',
  surcharge: 0,
  requiresCustomerData: false,
};

/** A buy-now-pay-later method: the vendor refuses it without a described payer, so it shows the form. */
const paylaterMethod: PaymentMethodView = {
  code: 'paylater-invoice',
  name: 'Invoice',
  description: 'Pay later by invoice',
  surcharge: 0,
  requiresCustomerData: true,
};

/**
 * The vendor submission result. `submitResponse` carries the tokenized instrument and `threatMetrixId` the
 * device fingerprint. `customerResponse` is the customer the vendor form created; only its ID travels, as a
 * candidate the processor verifies — resolving the payer stays the processor's work.
 */
type SubmitResult = {
  submitResponse?: { success?: boolean; status?: string; data?: { id?: string } };
  customerResponse?: { success?: boolean; id?: string; data?: { id?: string } };
  threatMetrixId?: string;
};

type CheckoutElement = { onPaymentSubmit?: (result: SubmitResult) => void };

/** The mounted `<unzer-payment>` stand-in, which records what the component pushed into it. */
const mountedPayment = () => document.querySelector('unzer-payment') as unknown as UnzerPaymentStub;

/**
 * Stand in for the vendor tokenization on the HOST-DRIVEN path: the next click on the hidden control inside
 * `<unzer-checkout>` makes the stub report `result` through `onPaymentSubmit`. Returns a mock the stub calls
 * on that click, so a test can assert the tokenization ran - or did not.
 */
const stubTokenization = (result: SubmitResult | null) => {
  const tokenize = jest.fn<() => void>();
  UnzerCheckoutStub.nextResult = result;
  UnzerCheckoutStub.onClick = tokenize;
  return tokenize;
};

/** The hidden control inside the mounted `<unzer-checkout>`. */
const submitControl = () => document.querySelector<HTMLButtonElement>('unzer-checkout [data-unzer-submit]');

/**
 * Install the customer data the vendor element reports through `getCustomerData()` — the values the shopper
 * typed into the element's own customer form. Passing `undefined` leaves the element without the method, the
 * shape a surface whose SDK predates the customer API has.
 */
const setCollectedCustomerData = (data: Record<string, unknown> | undefined) => {
  const paymentEl = document.querySelector('unzer-payment') as unknown as { getCustomerData?: () => unknown } | null;
  if (!paymentEl) {
    throw new Error('<unzer-payment> is not mounted');
  }
  if (data === undefined) {
    delete paymentEl.getCustomerData;
    return;
  }
  paymentEl.getCustomerData = () => data;
};

/**
 * Stand in for the vendor's OWN submission on the component-driven path: the real SDK submits when the
 * button inside `<unzer-checkout>` is clicked and reports the outcome through `onPaymentSubmit`, which is
 * what this invokes. There is no `submit()` call on that path — the component drives itself.
 */
const fireComponentSubmit = async (result: SubmitResult) => {
  const checkout = document.querySelector('unzer-checkout') as unknown as CheckoutElement | null;
  if (!checkout?.onPaymentSubmit) {
    throw new Error('<unzer-checkout> carries no onPaymentSubmit handler');
  }
  checkout.onPaymentSubmit(result);
  await flushPromises();
};

describe('UnzerMethodComponent', () => {
  let fetchMock: FetchMock;
  let host: HTMLDivElement;

  beforeEach(() => {
    defineUnzerElements();
    fetchMock = installFetchMock();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'method';
    document.body.appendChild(host);
    UnzerCheckoutStub.nextResult = { submitResponse: { success: true, data: { id: 'unzer-type-1' } } };
    UnzerCheckoutStub.onClick = undefined;
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  const build = (
    over: {
      method?: PaymentMethodView;
      showPayButton?: boolean;
      shopper?: PaymentConfig['shopper'];
      /** The config's display locale — the cart's, and the one every rendered string follows. */
      locale?: string;
      /** The cart's ISO-4217 currency, paired with the exponent commercetools stores its amounts at. */
      currency?: string;
      /** The session cart total in minor units, and the exponent it is denominated at. */
      amount?: number;
      fractionDigits?: number;
      /** The purchase country the instalment plan fetch is priced for. */
      country?: string;
      /** What the HOST states about the payer at mount time, over the processor's own prefill. */
      customer?: ComponentOptions['customer'];
    } = {},
  ) => {
    const method = over.method ?? cardMethod;
    const { baseOptions, onComplete, onError, onActionRequired } = makeBaseOptions({
      config: {
        publicKey: 's-pub-abc',
        environment: 'sandbox',
        locale: over.locale ?? 'en-GB',
        currency: over.currency ?? 'EUR',
        fractionDigits: over.fractionDigits ?? 2,
        amount: over.amount ?? 1999,
        country: over.country ?? 'DE',
        customerType: 'B2C',
        paymentMethods: [method],
        ...(over.shopper ? { shopper: over.shopper } : {}),
      },
    });
    const builder = new UnzerMethodBuilder(baseOptions, method);
    const component = builder.build({
      showPayButton: over.showPayButton ?? false,
      ...(over.customer ? { customer: over.customer } : {}),
    }) as UnzerMethodComponent;
    return { component, onComplete, onError, onActionRequired };
  };

  it('renders <unzer-payment publicKey locale> with the method element and a sibling <unzer-checkout>', async () => {
    const { component } = build();
    await component.mount('#method');

    const payment = host.querySelector('unzer-payment');
    expect(payment).not.toBeNull();
    expect(payment!.getAttribute('publicKey')).toBe('s-pub-abc');
    expect(payment!.getAttribute('locale')).toBe('en-GB');
    expect(payment!.querySelector('unzer-card')).not.toBeNull();
    expect(host.querySelector('unzer-checkout')).not.toBeNull();
  });

  /**
   * Click to Pay. Unzer draws it inside the card element's own iframe and it is ON by default,
   * so the only lever the surface has is `disableCTP` on `<unzer-payment>`. Three cases, and the
   * difference between the last two is the whole point: `false` is the merchant switching it off, while
   * ABSENT means the method's surface cannot carry it and nothing should be asserted about it.
   */
  it('leaves Click to Pay to the vendor when the merchant enabled it', async () => {
    const { component } = build({ method: { ...cardMethod, clickToPayEnabled: true } });
    await component.mount('#method');

    expect(host.querySelector('unzer-payment')!.hasAttribute('disableCTP')).toBe(false);
  });

  it('disables Click to Pay when the merchant switched it off', async () => {
    const { component } = build({ method: { ...cardMethod, clickToPayEnabled: false } });
    await component.mount('#method');

    expect(host.querySelector('unzer-payment')!.hasAttribute('disableCTP')).toBe(true);
  });

  it('sets no Click-to-Pay attribute on a method that cannot carry it', async () => {
    const { component } = build({ method: paylaterMethod });
    await component.mount('#method');

    expect(host.querySelector('unzer-payment')!.hasAttribute('disableCTP')).toBe(false);
  });

  // The HOST owns the pay button: commercetools Checkout draws its own and a storefront draws its own, and
  // each calls submit(). Whatever the host asks for, this surface draws none the shopper could see.
  it('renders no visible pay button, even when the host asks for one', async () => {
    const { component } = build({ showPayButton: true, locale: 'de-DE' });
    await component.mount('#method');

    expect(host.querySelector('[data-unzer-pay]')).toBeNull();
    expect(submitControl()!.hidden).toBe(true);
    expect(submitControl()!.textContent).toBe('');
  });

  it('reports an initialization failure in the language of the config locale', async () => {
    // A submit before any mount has upgraded the element is the INIT failure path.
    const { component, onError } = build({ locale: 'de-DE' });

    await component.submit();

    expect(onError).toHaveBeenCalledWith(
      'Die Zahlung konnte nicht initialisiert werden. Bitte versuchen Sie es erneut.',
    );
  });

  // The vendor submits on a click of a button that is its OWN child, and reports the outcome through
  // `onPaymentSubmit`. A button rendered as a SIBLING of `<unzer-checkout>` is not wired to anything.
  it('renders the hidden submit control INSIDE <unzer-checkout> so the vendor component drives submission', async () => {
    const { component } = build();
    await component.mount('#method');

    const checkout = host.querySelector('unzer-checkout')!;
    const control = checkout.querySelector<HTMLButtonElement>('[data-unzer-submit]')!;
    expect(control).not.toBeNull();
    expect(control.hidden).toBe(true);
    expect(control.getAttribute('aria-hidden')).toBe('true');
    expect(control.getAttribute('tabindex')).toBe('-1');
    expect(host.querySelector(':scope > [data-unzer-submit]')).toBeNull();
  });

  it('registers the onPaymentSubmit handler on <unzer-checkout> during mount', async () => {
    const { component } = build();
    await component.mount('#method');

    const checkout = host.querySelector('unzer-checkout') as unknown as CheckoutElement;
    expect(typeof checkout.onPaymentSubmit).toBe('function');
  });

  it('POSTs from the vendor-driven submission without the host calling submit()', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(tokenize).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCall(fetchMock, 0).body).toMatchObject({ resourceId: 'unzer-type-1' });
  });

  /**
   * The device-fingerprint id exists ONLY in this response, so it can only be learned here. The customer the
   * vendor form created is reported here too, and its ID is forwarded as a CANDIDATE — that resource
   * carries the date of birth `getCustomerData()` does not return. The processor verifies the id with the
   * server credential and refuses one belonging to a registered shopper, so what travels is a hint, not an
   * instruction: the payer is still resolved server-side.
   */
  it('forwards the device fingerprint and the candidate customer id the vendor reported', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({
      submitResponse: { success: true, data: { id: 'unzer-type-1' } },
      customerResponse: { success: true, data: { id: 's-cst-77' } },
      threatMetrixId: 'tmx-9f1c',
    });

    const body = readCall(fetchMock, 0).body as Record<string, unknown>;
    expect(body).toMatchObject({ deviceFingerprintId: 'tmx-9f1c', vendorCustomerId: 's-cst-77' });
    // Still no field through which the browser could name the payer itself.
    expect(body).not.toHaveProperty('providerCustomerId');
  });

  it('sends no candidate customer id when the vendor reported none', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(readCall(fetchMock, 0).body).not.toHaveProperty('vendorCustomerId');
  });

  // The SDK's wrapper shape is not published, so the id is read from the positions it plausibly occupies.
  it.each([
    ['customerResponse.id', { success: true, id: 's-cst-flat' }],
    ['customerResponse.data.id', { success: true, data: { id: 's-cst-flat' } }],
    ['a SUCCESS status beside the flag', { success: true, status: 'SUCCESS', id: 's-cst-flat' }],
  ])('reads the candidate id from %s', async (_case, customerResponse) => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({
      submitResponse: { success: true, data: { id: 'unzer-type-1' } },
      customerResponse,
    });

    expect(readCall(fetchMock, 0).body).toMatchObject({ vendorCustomerId: 's-cst-flat' });
  });

  /**
   * A FAILED customer carries an id too, and it is an ERROR resource. The failure is the ordinary one: the
   * element POSTs the customer with our merchant reference on it, so the shopper's SECOND checkout answers
   * `success: false`, `status: "ERROR"`, `data.id: "s-err-…"`, `"customerId already exists"`. Sent on, that id
   * became `resources.customerId` and the vendor refused the charge.
   *
   * Nothing is reported instead — which is the right answer, not a loss: the processor maps the payer from the
   * cart, reads the customer by that same reference and updates it.
   */
  it.each([
    ['the vendor reports failure', { success: false, status: 'ERROR', data: { id: 's-err-09a6', isError: true } }],
    ['an ERROR status beside a success flag', { success: true, status: 'ERROR', id: 's-err-09a6' }],
    ['an error resource id on a successful-looking response', { success: true, id: 's-err-09a6' }],
    ['no success flag at all', { id: 's-cst-flat' }],
  ])('sends no candidate id when %s', async (_case, customerResponse) => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({
      submitResponse: { success: true, data: { id: 'unzer-type-1' } },
      customerResponse,
    });

    // The charge still goes out — only the customer id is withheld.
    expect(readCall(fetchMock, 0).body).not.toHaveProperty('vendorCustomerId');
    expect(readCall(fetchMock, 0).body).toMatchObject({ resourceId: 'unzer-type-1' });
  });

  // Fallback: the element's own store reports the resource it created or loaded.
  it('falls back to the id the element reports through getCustomerData', async () => {
    const { component } = build({ method: paylaterMethod });
    await component.mount('#method');
    setCollectedCustomerData({ id: 's-cst-from-store', firstname: 'Max' });
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(readCall(fetchMock, 0).body).toMatchObject({ vendorCustomerId: 's-cst-from-store' });
  });

  /**
   * The shopper's DATE OF BIRTH is the one customer datum the processor cannot derive: a commercetools cart
   * carries none, and buy-now-pay-later methods are refused without it (`paylater-invoice` answers
   * `COR.100.301.112` "Missing element 'Transaction/Customer/Name/Birthdate'"). The vendor's paylater
   * element renders the field and `<unzer-payment>.getCustomerData()` returns what the shopper typed, so
   * this component reads that collected data and forwards it as `collectedCustomer` — for the processor to map
   * the payer from the cart WITH the data the cart was missing. Only when the element reported no customer of
   * its own; see the next case.
   */
  it.each([
    ['the vendor API format', '1985-04-09'],
    ['a compact date', '19850409'],
    ['a German display format', '09.04.1985'],
  ])('forwards the collected date of birth as YYYYMMDD from %s', async (_case, collected) => {
    const { component } = build();
    await component.mount('#method');
    setCollectedCustomerData({ birthDate: collected });
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(readCall(fetchMock, 0).body).toMatchObject({ collectedCustomer: { dateOfBirth: '19850409' } });
  });

  /**
   * With a customer the element created, the form's values stay in the browser: the processor charges
   * THAT resource and maps nothing from the cart, so nobody would read them - and shopper data no one reads has
   * no business leaving the browser.
   */
  it('sends no collected customer data when the element reported a customer of its own', async () => {
    const { component } = build();
    await component.mount('#method');
    setCollectedCustomerData({ id: 's-cst-from-element', birthDate: '1985-04-09', firstname: 'Peter' });
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    const body = readCall(fetchMock, 0).body as Record<string, unknown>;
    expect(body).toMatchObject({ vendorCustomerId: 's-cst-from-element' });
    expect(body).not.toHaveProperty('collectedCustomer');
  });

  // Not only the birthdate: a shopper who had to type their name, contact and address into the form (a guest
  // cart names nobody) must have all of it reach the processor, which merges it under the cart.
  it('forwards every collected field, in the processor field names', async () => {
    const { component } = build({ method: paylaterMethod });
    await component.mount('#method');
    setCollectedCustomerData({
      firstname: 'Max',
      lastname: 'Mustermann',
      email: 'max@example.com',
      mobile: '+49 69 000',
      salutation: 'mr',
      birthDate: '1985-04-09',
      billingAddress: { street: 'Hugo-Junkers-Str. 5', zip: '60386', city: 'Frankfurt', country: 'DE' },
    });
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(readCall(fetchMock, 0).body).toMatchObject({
      collectedCustomer: {
        firstName: 'Max',
        lastName: 'Mustermann',
        email: 'max@example.com',
        phone: '+49 69 000',
        salutation: 'mr',
        dateOfBirth: '19850409',
        billingAddress: { street: 'Hugo-Junkers-Str. 5', postalCode: '60386', city: 'Frankfurt', countryCode: 'DE' },
      },
    });
  });

  it('forwards the collected salutation', async () => {
    const { component } = build();
    await component.mount('#method');
    setCollectedCustomerData({ salutation: 'mrs' });
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(readCall(fetchMock, 0).body).toMatchObject({ collectedCustomer: { salutation: 'mrs' } });
  });

  // An unusable value is OMITTED rather than guessed: the processor's own fallback (the signed-in shopper's
  // commercetools profile) can still answer, and a malformed date would be rejected by the vendor's schema
  // with a message about our request rather than about the shopper's input.
  it.each([
    ['no customer data at all', undefined],
    ['an empty birth date', { birthDate: '' }],
    ['an unparseable birth date', { birthDate: 'not-a-date' }],
    ['a salutation the vendor does not accept', { salutation: 'dr' }],
  ])('omits the field for %s', async (_case, collected) => {
    const { component } = build();
    await component.mount('#method');
    setCollectedCustomerData(collected as Record<string, unknown> | undefined);
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    const body = readCall(fetchMock, 0).body as Record<string, unknown>;
    const sent = (body.collectedCustomer ?? {}) as Record<string, unknown>;
    expect(sent).not.toHaveProperty('dateOfBirth');
    if (_case === 'a salutation the vendor does not accept') {
      expect(sent).not.toHaveProperty('salutation');
    }
  });

  // A surface whose element predates the customer API must still be able to pay: the reader is optional.
  it('pays normally when the element exposes no getCustomerData', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCall(fetchMock, 0).body).toMatchObject({ resourceId: 'unzer-type-1' });
  });

  /**
   * The BASKET push, which is the merchant's switch made visible: `sendsBasketData` is their
   * `sendBasketData` config projected for the surface, and the element is handed the purchase's figures only
   * when it is on. The object is the reference integration's exactly - `{ amount, currencyType }`, amount in
   * MAJOR units - and the amount is the bare cart total: the surcharge is the server's business (P4).
   */
  describe('UnzerMethodComponent — the basket push', () => {
    const basketMethod = { ...cardMethod, needsAmountData: true };

    it.each([
      ['two decimals', 1999, 2, 19.99],
      ['no decimals (JPY)', 1999, 0, 1999],
      ['three decimals (BHD)', 1999, 3, 1.999],
    ])('hands the element the cart total in major units — %s', async (_case, amount, fractionDigits, expected) => {
      const { component } = build({ method: basketMethod, amount, fractionDigits });
      await component.mount('#method');

      expect(mountedPayment().basketData).toEqual([{ amount: expected, currencyType: 'EUR', country: 'DE' }]);
    });

    it('pushes nothing for a method whose surface needs no figures', async () => {
      const { component } = build();
      await component.mount('#method');

      expect(mountedPayment().basketData).toEqual([]);
    });

    /**
     * The COUNTRY, which is what the instalment plan fetch was refused without: a lender prices a plan per
     * market, so it is part of the question. A cart that names none pushes the figures without it rather than
     * inventing one.
     */
    it('omits the country when the cart names none', async () => {
      const { component } = build({ method: basketMethod, country: '' });
      await component.mount('#method');

      expect(mountedPayment().basketData).toEqual([{ amount: 19.99, currencyType: 'EUR' }]);
    });

    it('pushes nothing when the config carries no amount', async () => {
      const { component } = build({ method: basketMethod, amount: 0 });
      await component.mount('#method');

      expect(mountedPayment().basketData).toEqual([]);
    });

    /**
     * NEVER FATAL. The setter is optional on the element, the vendor may reject the call, and it may answer a
     * promise that never settles — a payable form must survive all three, because none of them is a reason to
     * refuse a payment.
     */
    it('mounts and pays when the element rejects the basket push', async () => {
      const { component } = build({ method: basketMethod });
      Object.defineProperty(UnzerPaymentStub.prototype, 'setBasketData', {
        configurable: true,
        value() {
          throw new Error('vendor refused');
        },
      });

      await component.mount('#method');

      expect(host.querySelector('unzer-payment')).not.toBeNull();
      expect(host.querySelector('unzer-checkout')).not.toBeNull();

      // Restore the recording stub for the rest of the suite.
      Object.defineProperty(UnzerPaymentStub.prototype, 'setBasketData', {
        configurable: true,
        value(this: UnzerPaymentStub, data: { amount: number; currencyType: string }) {
          this.basketData.push(data);
        },
      });
    });

    it('does not wait on a basket push that never settles', async () => {
      const { component } = build({ method: basketMethod });
      Object.defineProperty(UnzerPaymentStub.prototype, 'setBasketData', {
        configurable: true,
        value: () => new Promise(() => {}),
      });

      await component.mount('#method');

      expect(host.querySelector('unzer-checkout')).not.toBeNull();

      Object.defineProperty(UnzerPaymentStub.prototype, 'setBasketData', {
        configurable: true,
        value(this: UnzerPaymentStub, data: { amount: number; currencyType: string }) {
          this.basketData.push(data);
        },
      });
    });
  });

  /**
   * The WALLET push. The processor assembled the sheet's data; this component's only decisions are
   * WHICH vendor setter to call and how not to break a mount - so the payload must arrive at the setter exactly
   * as it came, and a wallet must never get our own pay button on top of the vendor's.
   */
  describe('UnzerMethodComponent — the wallet push', () => {
    const applePayload = { currencyCode: 'EUR', total: { label: 'Shop', amount: '19.99' } };
    const googlePayload = { gatewayMerchantId: '9138634f404b', allowCreditCards: true };

    it('hands Apple’s payload to setApplePayData verbatim, and carries no authorisation callback', async () => {
      const { component } = build({
        method: {
          ...cardMethod,
          code: 'applepay',
          rendersOwnPayButton: true,
          wallet: { kind: 'applepay', payload: applePayload },
        },
      });
      await component.mount('#method');

      const [pushed] = mountedPayment().applePayData as Record<string, unknown>[];
      expect(pushed).toEqual(applePayload);
      expect(mountedPayment().googlePayData).toEqual([]);
    });

    it('hands Google’s payload to setGooglePayData verbatim, and carries no authorisation callback', async () => {
      const { component } = build({
        method: {
          ...cardMethod,
          code: 'googlepay',
          rendersOwnPayButton: true,
          wallet: { kind: 'googlepay', payload: googlePayload },
        },
      });
      await component.mount('#method');

      const [pushed] = mountedPayment().googlePayData as Record<string, unknown>[];
      expect(pushed).toEqual(googlePayload);
      expect(mountedPayment().applePayData).toEqual([]);
    });

    it('pushes nothing for a method the processor sent no wallet block for', async () => {
      const { component } = build();
      await component.mount('#method');

      expect(mountedPayment().applePayData).toEqual([]);
      expect(mountedPayment().googlePayData).toEqual([]);
    });

    /**
     * The wallet button IS the vendor's - Apple's and Google's sheets open only from it. A wallet surface gets no
     * submit control at all: there is nothing a host could click on its behalf.
     */
    /**
     * THE HOST'S BUTTON OVER A WALLET. Checkout asks `isValid()` before it starts a transaction, so a wallet
     * answering `false` keeps it from starting one it could never finish; `showValidation()` is then where the
     * shopper is told which button pays and the vendor's own button takes focus.
     */
    const walletMethod = {
      ...cardMethod,
      code: 'googlepay',
      rendersOwnPayButton: true,
      wallet: { kind: 'googlepay', payload: googlePayload },
    };

    /** The vendor draws its button inside its own element; this stands in for that. */
    const vendorButton = (): HTMLButtonElement => {
      const walletEl = host.querySelector('unzer-google-pay') as HTMLElement;
      const button = document.createElement('button');
      button.textContent = 'Google Pay';
      walletEl.appendChild(button);
      return button;
    };

    it('answers isValid() false for a wallet, so the host never submits one', async () => {
      const { component } = build({ method: walletMethod });
      await component.mount('#method');

      await expect(component.isValid()).resolves.toBe(false);
    });

    it('showValidation() brings the wallet surface into view and points at it with an icon', async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
      const { component } = build({ method: walletMethod });
      await component.mount('#method');
      vendorButton();

      await component.showValidation();

      const walletEl = host.querySelector('unzer-google-pay') as HTMLElement;
      expect(scrollIntoView).toHaveBeenCalled();
      expect(host.querySelector('[data-unzer-wallet-pointer]')).not.toBeNull();
      expect(walletEl.getAttribute('style')).toBeNull();
    });

    it('showValidation() draws the pointer once, however often the host validates', async () => {
      const { component } = build({ method: walletMethod });
      await component.mount('#method');
      vendorButton();

      await component.showValidation();
      await component.showValidation();

      expect(host.querySelectorAll('[data-unzer-wallet-pointer]')).toHaveLength(1);
    });

    it('showValidation() names the vendor button and moves focus to it', async () => {
      const { component } = build({ method: walletMethod });
      await component.mount('#method');
      const button = vendorButton();

      await component.showValidation();

      expect(host.textContent).toContain(resolveShopperTexts('en-GB').useVendorButton);
      expect(document.activeElement).toBe(button);
    });

    it('a host-driven submit on a wallet names the vendor button, focuses it and posts nothing', async () => {
      const { component, onError } = build({ method: walletMethod });
      await component.mount('#method');
      const button = vendorButton();

      await component.submit();

      expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').useVendorButton);
      expect(document.activeElement).toBe(button);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renders no submit control for a wallet, even when the host asks for a pay button', async () => {
      const { component } = build({
        showPayButton: true,
        method: {
          ...cardMethod,
          code: 'googlepay',
          rendersOwnPayButton: true,
          wallet: { kind: 'googlepay', payload: googlePayload },
        },
      });
      await component.mount('#method');

      expect(host.querySelector('[data-unzer-pay]')).toBeNull();
      expect(host.querySelector('[data-unzer-submit]')).toBeNull();
      expect(host.querySelector('unzer-checkout')).not.toBeNull();
    });

    /**
     * The other half of "the button is the vendor's": a host that calls `submit()` anyway must be refused.
     * The element would tokenize - against a sheet Apple or Google never showed the shopper - so the host
     * is told which button pays, and no charge is posted.
     */
    it('refuses a host-driven submit on a wallet surface and names the vendor button', async () => {
      const { component, onError } = build({
        method: {
          ...cardMethod,
          code: 'googlepay',
          rendersOwnPayButton: true,
          wallet: { kind: 'googlepay', payload: googlePayload },
        },
      });
      await component.mount('#method');
      fetchMock.mockClear();

      await component.submit();

      expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').useVendorButton);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a wallet surface stays invalid however long it is mounted: only its own button pays', async () => {
      const { component } = build({ method: walletMethod });
      await component.mount('#method');
      vendorButton();

      await expect(component.isValid()).resolves.toBe(false);
    });

    // NEVER FATAL, for the same three reasons the basket push is not.
    it('mounts when the element rejects the wallet push', async () => {
      const { component } = build({
        method: {
          ...cardMethod,
          code: 'googlepay',
          rendersOwnPayButton: true,
          wallet: { kind: 'googlepay', payload: googlePayload },
        },
      });
      Object.defineProperty(UnzerPaymentStub.prototype, 'setGooglePayData', {
        configurable: true,
        value() {
          throw new Error('vendor refused');
        },
      });

      await component.mount('#method');

      expect(host.querySelector('unzer-payment')).not.toBeNull();
      expect(host.querySelector('unzer-checkout')).not.toBeNull();

      Object.defineProperty(UnzerPaymentStub.prototype, 'setGooglePayData', {
        configurable: true,
        value(this: UnzerPaymentStub, data: Record<string, unknown>) {
          this.googlePayData.push(data);
        },
      });
    });
  });

  // The component pushes no basket for a method the merchant did not ask one for, and the CUSTOMER it does push
  // is `setCustomerData` alone — the field-by-field setter stays the fallback.
  it('pushes no basket and no field-by-field customer data for a plain card', async () => {
    const { component } = build();
    await component.mount('#method');

    expect(mountedPayment().basketData).toEqual([]);
    expect(mountedPayment().customerData).toEqual([]);
  });

  /**
   * A method the vendor refuses without a described payer gets the vendor's OWN customer form, and it is
   * prefilled with what the platform already knows so the shopper retypes nothing and the element asks only
   * for what is missing. The cart amount is still never pushed, and no customer id is created or
   * forwarded — the processor remains the one that builds the vendor customer resource.
   */
  it('mounts the vendor customer form for a method that requires customer data', async () => {
    const { component } = build({ method: paylaterMethod });
    await component.mount('#method');

    expect(host.querySelector('unzer-payment > unzer-customer-form')).not.toBeNull();
    expect(host.querySelector('unzer-payment > unzer-paylater-invoice')).not.toBeNull();
  });

  it('mounts no customer form for a method that needs no described payer', async () => {
    const { component } = build();
    await component.mount('#method');

    expect(host.querySelector('unzer-customer-form')).toBeNull();
  });

  it('prefills the form with the platform data, in the vendor field shapes', async () => {
    const { component } = build({
      method: paylaterMethod,
      shopper: {
        firstName: 'Branko',
        lastName: 'Janjic',
        email: 'branko@example.com',
        salutation: 'mr',
        dateOfBirth: '19861212',
        phone: '+49 69 000',
        billingAddress: {
          street: 'Hugo-Junkers-Str.',
          houseNumber: '5',
          postalCode: '60386',
          city: 'Frankfurt am Main',
          countryCode: 'DE',
        },
      },
    });

    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData).toEqual([
      {
        firstname: 'Branko',
        lastname: 'Janjic',
        email: 'branko@example.com',
        salutation: 'mr',
        // The platform holds ONE number; the vendor form has two fields and neither is optional for the
        // methods that need a customer, so the same number answers both.
        phone: '+49 69 000',
        mobile: '+49 69 000',
        // The display locale's primary subtag — the customer's language on the vendor's own resource.
        language: 'en',
        // The vendor form takes the API date shape and a single street line.
        birthDate: '1986-12-12',
        billingAddress: {
          // The addressee, which the vendor address carries and commercetools keeps on the customer.
          name: 'Branko Janjic',
          street: 'Hugo-Junkers-Str. 5',
          zip: '60386',
          city: 'Frankfurt am Main',
          country: 'DE',
        },
        // No company: a PRIVATE customer, stated rather than left for the element to guess.
        customerSettings: { type: 'B2C' },
      },
    ]);
    expect(mountedPayment().customerData).toEqual([]);
  });

  /**
   * THE REFERENCE, which is what the whole `setCustomerData` shape exists for: the element creates
   * the vendor customer itself, and without a merchant reference on it the vendor has nothing to recognise the
   * shopper by - so every checkout produced a new customer resource. It is the platform customer id, and the
   * same one the connector maps a payer under for a charge that carries no such customer.
   */
  it('stamps the platform customer reference on the customer the element creates', async () => {
    const { component } = build({
      method: paylaterMethod,
      shopper: { customerReference: 'ct-cust-9', email: 'branko@example.com' },
    });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData[0]).toMatchObject({ customerId: 'ct-cust-9' });
  });

  /**
   * The `id` is what makes the element UPDATE rather than POST. Handed the reference alone it created a
   * second customer, and the vendor refused it on the shopper's next checkout - `"customerId already exists"`,
   * reported as an `s-err-` resource.
   */
  it('hands the element the held vendor customer id so it updates that resource', async () => {
    const { component } = build({
      method: paylaterMethod,
      shopper: { customerReference: 'ct-cust-9', vendorCustomerId: 's-cst-held', email: 'branko@example.com' },
    });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData[0]).toMatchObject({ id: 's-cst-held', customerId: 'ct-cust-9' });
  });

  // Nothing held yet (a first payment, or a provider with no such lookup): no `id`, and the element creates the
  // customer under the reference.
  it('hands no id when the processor names no held customer', async () => {
    const { component } = build({
      method: paylaterMethod,
      shopper: { customerReference: 'ct-cust-9', email: 'branko@example.com' },
    });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData[0]).not.toHaveProperty('id');
  });

  // A guest cart names no customer, so there is no reference to stamp — and a made-up one would collide
  // guests with each other on the vendor account.
  it('stamps no reference when the processor sent none', async () => {
    const { component } = build({ method: paylaterMethod, shopper: { email: 'branko@example.com' } });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData[0]).not.toHaveProperty('customerId');
  });

  // A field the processor did not send must NOT be pushed as an empty string: the element would treat it as
  // an answer and stop asking the shopper for it, which is the opposite of the point.
  it('prefills only the fields the processor actually sent', async () => {
    const { component } = build({ method: paylaterMethod, shopper: { email: 'branko@example.com' } });
    await component.mount('#method');

    // The language and the customer type are the connector's own statements, always present; every other
    // field is absent because the processor sent none.
    expect(mountedPayment().loadedCustomerData).toEqual([
      { email: 'branko@example.com', language: 'en', customerSettings: { type: 'B2C' } },
    ]);
  });

  it('pushes nothing when the processor sent no shopper block', async () => {
    const { component } = build({ method: paylaterMethod });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData).toEqual([]);
    expect(mountedPayment().customerData).toEqual([]);
  });

  /**
   * ONE call, through the API loader, which reverses the field-by-field rule: the element
   * writes a CUSTOMER RESOURCE, and only API data carries what that resource needs and the form does not render
   * - the merchant reference above all, then `phone`, `mobile` and `language`. The field-by-field setter is the
   * fallback for an SDK that exposes no loader, and it is never both.
   */
  it('prefills through the API loader in one call and never the field setter', async () => {
    const { component } = build({ method: paylaterMethod, shopper: { email: 'branko@example.com' } });
    await component.mount('#method');

    expect(mountedPayment().loadedCustomerData).toHaveLength(1);
    expect(mountedPayment().customerData).toEqual([]);
  });

  /**
   * The customer goes to EVERY method, form or no form: the element writes its customer resource either way and
   * the charge links it, so a card payment whose customer names nobody fails the vendor's own checks for the
   * same reason a paylater one does. Only the visible `<unzer-customer-form>` stays behind `requiresCustomerData`.
   */
  it('hands the customer to a method that shows no form too', async () => {
    const { component } = build({ shopper: { email: 'branko@example.com' } });
    await component.mount('#method');

    expect(host.querySelector('unzer-customer-form')).toBeNull();
    expect(mountedPayment().loadedCustomerData).toEqual([
      { email: 'branko@example.com', language: 'en', customerSettings: { type: 'B2C' } },
    ]);
  });

  it('reports a shopper-safe error and does not POST when the component-driven submission fails', async () => {
    const { component, onError } = build();
    await component.mount('#method');

    await fireComponentSubmit({ submitResponse: { success: false } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(typeof onError.mock.calls[0][0]).toBe('string');
  });

  it('guards a double submission across BOTH paths: a spent surface does not POST again', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValue(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await fireComponentSubmit({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });
    await component.submit();

    expect(tokenize).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tokenizes then POSTs { paymentMethodCode, resourceId, returnUrl } with NO basket/cart data', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const tokenize = stubTokenization({
      submitResponse: { success: true, status: 'SUCCESS', data: { id: 'unzer-type-1' } },
    });

    await component.submit();

    expect(tokenize).toHaveBeenCalledTimes(1);
    const call = readCall(fetchMock, 0);
    expect(call.url).toBe('https://proc.example/payments');
    expect(call.method).toBe('POST');
    expect(call.headers['X-Session-Id']).toBe('sess-123');
    expect(call.body).toEqual({
      paymentMethodCode: 'card',
      resourceId: 'unzer-type-1',
      returnUrl: 'https://storefront.example/checkout',
      locale: 'en-GB',
    });
    // The invariant: the browser sends no basket/cart data and no amount.
    const body = call.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('basket');
    expect(body).not.toHaveProperty('lineItems');
    expect(body).not.toHaveProperty('cart');
    expect(body).not.toHaveProperty('amount');
    expect(JSON.stringify(body)).not.toMatch(/lineItem|basket|amount/i);
  });

  it('navigates on a redirect follow-up and notifies onActionRequired without awaiting it', async () => {
    const { component, onActionRequired } = build();
    const restore = installLocationMock();
    const location = restore.location;
    try {
      await component.mount('#method');
      fetchMock.mockResolvedValueOnce(
        okJson({
          paymentReference: 'pay-1',
          action: { kind: 'redirect', payload: { url: 'https://unzer.example/3ds' } },
        }),
      );
      stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

      await component.submit();

      expect(onActionRequired).toHaveBeenCalledTimes(1);
      expect(onActionRequired).toHaveBeenCalledWith({ type: 'fullscreen' });
      expect(location.assign).toHaveBeenCalledWith('https://unzer.example/3ds');
    } finally {
      restore.restore();
    }
  });

  it('completes on a none follow-up', async () => {
    const { component, onComplete } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await component.submit();

    expect(onComplete).toHaveBeenCalledWith({ isSuccess: true, paymentReference: 'pay-1' });
  });

  it('reports a shopper-safe error when the tokenization fails, and does not POST', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    stubTokenization({ submitResponse: { success: false } });

    await component.submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(typeof onError.mock.calls[0][0]).toBe('string');
  });

  it('reports an initialization failure when the submit control is gone, instead of doing nothing', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    // A host that re-rendered the container tore the vendor's control out; there is nothing left to click.
    submitControl()!.remove();

    await component.submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').paymentInitFailed);
  });

  // The vendor keeps its control disabled while the form is incomplete or invalid, and a click on a disabled
  // button reaches nobody. The host is told, and told what: the shopper has a form to finish, not a failure.
  it('reports paymentDetailsIncomplete while the vendor keeps the control disabled, and does not POST', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });
    submitControl()!.disabled = true;

    await component.submit();

    expect(tokenize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').paymentDetailsIncomplete);
  });

  /**
   * THE VENDOR'S OWN VERDICT ON THE FORM. `<unzer-payment>` reports `stateChanged` with
   * `detail.enableCheckout` - its answer to "may this be paid now" - and that answer outranks the control's
   * `disabled`, which the vendor does not always set. Until the vendor has spoken the control still decides,
   * so a method that reports no state is never made unpayable.
   */

  it('is not valid once the vendor reports an unfinished form, whatever the control says', async () => {
    const { component } = build();
    await component.mount('#method');
    await expect(component.isValid()).resolves.toBe(true);

    reportVendorState(false);

    expect(submitControl()!.disabled).toBe(false);
    await expect(component.isValid()).resolves.toBe(false);
  });

  it('is valid again once the vendor reports the form finished', async () => {
    const { component } = build();
    await component.mount('#method');
    reportVendorState(false);

    reportVendorState(true);

    await expect(component.isValid()).resolves.toBe(true);
  });

  it('refuses a submit over an unfinished form: nothing is tokenized and the shopper is taken to it', async () => {
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
    const { component, onError } = build();
    await component.mount('#method');
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });
    reportVendorState(false);

    await component.submit();

    expect(tokenize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').paymentDetailsIncomplete);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  const reportVendorState = (enableCheckout: boolean) => {
    mountedPayment().dispatchEvent(new CustomEvent('stateChanged', { detail: { enableCheckout } }));
  };

  /**
   * VALIDATION BEFORE THE HOST COMMITS. The vendor validates only inside its own submission, and a refusal
   * costs nothing - it fails before it tokenizes. So `isValid()`, which commercetools Checkout asks BEFORE it
   * starts its transaction, runs that submission: a refusal answers `false` and the host never starts, and a
   * pass leaves the tokenization in hand for the `submit()` that follows, which must not ask the vendor twice.
   */
  /**
   * THE VENDOR REDDENS A FIELD ONLY ONCE IT HAS BEEN TOUCHED - focused and left - which a submission the
   * shopper never made does not do. So `showValidation()` touches every field the vendor drew, in place, and
   * leaves focus on the first one.
   */
  it('showValidation touches every vendor field so the vendor marks the invalid ones', async () => {
    const { component } = build();
    await component.mount('#method');
    const paymentEl = mountedPayment();
    const first = document.createElement('input');
    const second = document.createElement('input');
    paymentEl.append(first, second);
    const touches: string[] = [];
    for (const [name, field] of [
      ['first', first],
      ['second', second],
    ] as const) {
      field.addEventListener('focus', () => touches.push(`${name}:focus`));
      field.addEventListener('blur', () => touches.push(`${name}:blur`));
    }

    await component.showValidation();

    expect(touches).toEqual(['first:focus', 'first:blur', 'second:focus', 'second:blur', 'first:focus']);
    expect(document.activeElement).toBe(first);
  });

  /**
   * A REDIRECT METHOD HAS NOTHING TO VALIDATE. Its element draws no field, so making the vendor submit would
   * not check anything - it would start the payment at the moment the host is only asking whether it may.
   * Such a method answers on its control, as it always did, and the vendor is asked once, by `submit()`.
   */
  it('never submits to validate a method whose element draws no field', async () => {
    const { component } = build({ method: { ...cardMethod, code: 'bancontact', name: 'Bancontact' } });
    await component.mount('#method');
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await expect(component.isValid()).resolves.toBe(true);

    expect(tokenize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isValid runs the vendor validation and answers false when the vendor refuses the form', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    mountedPayment().appendChild(document.createElement('input'));
    const tokenize = stubTokenization({
      submitResponse: { success: false, status: 'ERROR' },
    });

    await expect(component.isValid()).resolves.toBe(false);

    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('a validated form is posted by submit without a second vendor submission', async () => {
    const { component } = build();
    await component.mount('#method');
    mountedPayment().appendChild(document.createElement('input'));
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await expect(component.isValid()).resolves.toBe(true);
    await component.submit();

    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCall(fetchMock).body.resourceId).toBe('unzer-type-1');
  });

  it('a form the shopper changed after validating is validated again, never posted stale', async () => {
    const { component } = build();
    await component.mount('#method');
    mountedPayment().appendChild(document.createElement('input'));
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });
    await expect(component.isValid()).resolves.toBe(true);

    reportVendorState(true);
    await component.submit();

    expect(tokenize).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('isValid follows the vendor control: enabled is valid, disabled is not, unmounted is not', async () => {
    const { component } = build();
    await expect(component.isValid()).resolves.toBe(false);

    await component.mount('#method');
    await expect(component.isValid()).resolves.toBe(true);

    submitControl()!.disabled = true;
    await expect(component.isValid()).resolves.toBe(false);
  });

  // A vendor that never reports - a refusal that fires no callback, a synthetic click it ignored - must not
  // leave the host waiting on the promise forever: that is the hang this whole path exists to end.
  it('gives up on a vendor that never reports, tells the host, and resolves', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    const tokenize = stubTokenization(null);
    jest.useFakeTimers();
    try {
      const pending = component.submit();
      await Promise.resolve();
      expect(tokenize).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      jest.advanceTimersByTime(30_000);
      await pending;

      expect(fetchMock).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(resolveShopperTexts('en-GB').paymentInitFailed);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a second submit while the first still waits on the vendor', async () => {
    const { component } = build();
    await component.mount('#method');
    const tokenize = stubTokenization(null);
    jest.useFakeTimers();
    try {
      const first = component.submit();
      await Promise.resolve();
      const second = component.submit();
      await Promise.resolve();

      expect(tokenize).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30_000);
      await Promise.all([first, second]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('guards a double submit: a second pay-click on a spent surface does not POST again', async () => {
    const { component } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValue(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const tokenize = stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await component.submit();
    await component.submit();

    expect(tokenize).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('formats a non-zero surcharge in the config currency and major units, not raw minor units', async () => {
    const method: PaymentMethodView = { ...cardMethod, name: 'Invoice', surcharge: 50 };
    const { component } = build({ method });
    await component.mount('#method');

    // The method NAME is not repeated above the form — the host names it on the row that was picked.
    expect(host.querySelector('[data-unzer-method-name]')).toBeNull();
    const surcharge = host.querySelector('[data-unzer-surcharge]')?.textContent ?? '';
    expect(surcharge).toContain('€0.50');
    expect(surcharge).not.toContain('+50');
  });

  // CLDR and commercetools disagree on the minor-unit exponent for RSD — CLDR gives it 0 digits where
  // commercetools stores 2 — so the surcharge must render at the `fractionDigits` the config carries and
  // never at whatever digit count `Intl` resolves for the currency. Left to `Intl`, a 50-minor-unit
  // surcharge reads as `1 RSD` on the surface the shopper consents on while `POST /payments` charges 50.
  it('renders the surcharge at the config fractionDigits, not the digits Intl resolves for the currency', async () => {
    const method: PaymentMethodView = { ...cardMethod, name: 'Invoice', surcharge: 50 };
    const { component } = build({ method, currency: 'RSD', locale: 'sr-RS' });
    await component.mount('#method');

    const surcharge = host.querySelector('[data-unzer-surcharge]')?.textContent ?? '';
    expect(surcharge).toContain('0,50');
    expect(surcharge).not.toContain('1 RSD');
  });

  it('renders no surcharge suffix when the surcharge is zero', async () => {
    const { component } = build({ method: { ...cardMethod, surcharge: 0 } });
    await component.mount('#method');

    expect(host.querySelector('[data-unzer-surcharge]')).toBeNull();
  });

  // `sdkAction` is the kind no shipped surface can drive. NOT `display`: that one became a COMPLETION
  // when the pay-by-transfer methods started answering with the account to transfer to.
  it('marks the surface spent after an unsupported action so a second pay-click does not re-post', async () => {
    const { component, onError } = build();
    await component.mount('#method');
    fetchMock.mockResolvedValue(okJson({ paymentReference: 'pay-1', action: { kind: 'sdkAction', payload: {} } }));
    stubTokenization({ submitResponse: { success: true, data: { id: 'unzer-type-1' } } });

    await component.submit();
    await component.submit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an unmapped method code', async () => {
    const method: PaymentMethodView = { ...cardMethod, code: 'no-such-method' };
    const { component, onError } = build({ method });

    await component.mount('#method');

    // Nothing rendered, and the HOST told — see `unzer-method-mount-failure.spec.ts` for why that is the
    // surface this asserts rather than a console line.
    expect(host.querySelector('unzer-payment')).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  /**
   * The B2B switch, in the ONE call the customer now travels in. Unzer decides which customer form to
   * render from the customer TYPE, and the type is API data - it rides with the values rather than in a second
   * call of its own, because it describes the same resource.
   */
  describe('UnzerMethodComponent — the B2B switch', () => {
    const b2bBuild = (customer: ComponentOptions['customer']) =>
      build({ method: paylaterMethod, customer, shopper: { email: 'branko@example.com' } });

    /**
     * The OWNER block, which is where the vendor reads a B2B payer's birthdate - not off the top-level
     * `birthDate`. Without it an edited date of birth landed top-level while the owner kept the stale one the
     * vendor form had collected, and the paylater check read that.
     */
    it('mirrors the payer onto companyInfo.owner for a B2B customer', async () => {
      const { component } = build({
        method: paylaterMethod,
        customer: { company: 'Universum GmbH', firstName: 'Pera', lastName: 'Perovic', dateOfBirth: '19971223' },
      });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData[0]).toMatchObject({
        birthDate: '1997-12-23',
        companyInfo: {
          registrationType: 'not_registered',
          owner: { firstname: 'Pera', lastname: 'Perovic', birthdate: '1997-12-23' },
        },
      });
    });

    // No company means no company block at all - and no owner either.
    it('sends no owner block for a private customer', async () => {
      const { component } = build({ method: paylaterMethod, customer: { firstName: 'Pera' } });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData[0]).not.toHaveProperty('companyInfo');
    });

    it('sets the B2B mode and the values in one loader call', async () => {
      const { component } = b2bBuild({ company: 'Universum GmbH' });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData).toEqual([
        {
          email: 'branko@example.com',
          language: 'en',
          company: 'Universum GmbH',
          // A business the platform can only NAME: the least the vendor accepts beside the name, so the
          // customer is declared B2B without claiming a registration nothing states.
          companyInfo: { registrationType: 'not_registered' },
          customerSettings: { type: 'B2B' },
        },
      ]);
      expect(mountedPayment().customerData).toEqual([]);
    });

    it('declares a customer with no company PRIVATE, and sends no company details', async () => {
      const { component } = b2bBuild({ firstName: 'Branko' });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData).toEqual([
        { email: 'branko@example.com', firstname: 'Branko', language: 'en', customerSettings: { type: 'B2C' } },
      ]);
    });

    /**
     * The regression this rule exists for: the company was read off the billing address unconditionally, so a
     * company left on the cart by an earlier visit outlived the shopper CLEARING it — the form came up B2B
     * against a form that said no such thing. A host that states `company` states its ABSENCE the same way.
     */
    it('turns B2B off when the host states an empty company, whatever the address still holds', async () => {
      const { component } = build({
        method: paylaterMethod,
        customer: { company: '' },
        shopper: { email: 'branko@example.com', billingAddress: { company: 'Stale GmbH', countryCode: 'DE' } },
      });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData[0]).toMatchObject({ customerSettings: { type: 'B2C' } });
      expect(mountedPayment().loadedCustomerData[0]).not.toHaveProperty('company');
    });

    // Only a host that says NOTHING about the company falls back to the address.
    it('falls back to the billing address when the host states no company at all', async () => {
      const { component } = build({
        method: paylaterMethod,
        customer: { firstName: 'Branko' },
        shopper: { email: 'branko@example.com', billingAddress: { company: 'Universum GmbH', countryCode: 'DE' } },
      });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData[0]).toMatchObject({
        company: 'Universum GmbH',
        customerSettings: { type: 'B2B' },
      });
    });
  });

  // The host owns the checkout form, so what the shopper typed there must win over the profile snapshot the
  // processor sent when the page was built — a birthdate typed after the config was fetched, above all.
  describe('UnzerMethodComponent — the host-supplied customer', () => {
    it('merges the host data over the processor prefill, field by field', async () => {
      const { component } = build({
        method: paylaterMethod,
        shopper: { email: 'stale@example.com', firstName: 'Branko', dateOfBirth: '19861212' },
        customer: { email: 'typed@example.com', dateOfBirth: '1990-11-05' },
      });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData).toEqual([
        {
          firstname: 'Branko',
          email: 'typed@example.com',
          birthDate: '1990-11-05',
          language: 'en',
          customerSettings: { type: 'B2C' },
        },
      ]);
    });

    // A host customer alone is enough: the processor sends no shopper block for a guest cart it knows nothing
    // about, and the form must still be filled with what the shopper just typed.
    it('prefills from the host alone when the processor sent no shopper block', async () => {
      const { component } = build({ method: paylaterMethod, customer: { email: 'typed@example.com' } });
      await component.mount('#method');

      expect(mountedPayment().loadedCustomerData).toEqual([
        { email: 'typed@example.com', language: 'en', customerSettings: { type: 'B2C' } },
      ]);
    });
  });
});
