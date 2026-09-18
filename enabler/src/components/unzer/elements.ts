/**
 * The VENDOR's own surface: which custom element each catalogue method maps to, and the subset of those
 * elements' APIs this library drives.
 *
 * Types and one table, no behaviour - so the base component and each per-method specialization
 * (`methods/*.ts`) describe the same element without one importing the other.
 */

/**
 * Fixed `paymentMethodCode → <unzer-{tag}>` mapping. The keys are catalogue method-type codes, spelled and
 * cased exactly as `METHOD_TRANSACTION_SUPPORT` declares them and `GET /operations/payment-config` returns
 * them; a key matching none of them is unreachable, which `test/unzer-method-elements.spec.ts` fails on by
 * reading that module rather than restating it. A catalogue code with no entry here has no Unzer v2
 * element: `createComponentBuilder` refuses it (`Component type not supported`) and a mount attempted
 * anyway reports it to the host through `onError` — never a silent gap. Validated against an Unzer
 * sandbox account.
 */
export const UNZER_METHOD_ELEMENTS: Readonly<Record<string, string>> = {
  card: 'unzer-card',
  paypal: 'unzer-paypal',
  ideal: 'unzer-ideal',
  'sepa-direct-debit': 'unzer-sepa-direct-debit',
  'paylater-invoice': 'unzer-paylater-invoice',
  'paylater-installment': 'unzer-paylater-installment',
  'paylater-direct-debit': 'unzer-paylater-direct-debit',
  EPS: 'unzer-eps',
  klarna: 'unzer-klarna',
  googlepay: 'unzer-google-pay',
  applepay: 'unzer-apple-pay',
  twint: 'unzer-twint',
  bancontact: 'unzer-bancontact',
  alipay: 'unzer-alipay',
  wechatpay: 'unzer-wechatpay',
  wero: 'unzer-wero',
  'openbanking-pis': 'unzer-open-banking',
  'post-finance-card': 'unzer-post-finance',
  'post-finance-efinance': 'unzer-post-finance-efinance',
  prepayment: 'unzer-prepayment',
  przelewy24: 'unzer-przelewy24',
  payu: 'unzer-payu',
  // `Readonly`, because the table is a FACT of this release and no caller has any business adding to it
  // at runtime. NOT frozen to its literal keys: every lookup is by a method code that arrives as a
  // runtime string from the shopper config, so literal keys would only force a cast at each call site.
};

/**
 * The result of a vendor submission, reported identically on both submission paths: the tokenized
 * instrument in `submitResponse`, plus the device-fingerprint id used for risk assessment, which exists
 * nowhere else and so can only be learned here.
 *
 * The vendor also reports the customer resource its own form created. Only that resource's ID travels, and the
 * processor charges THAT customer; the browser still names no shopper and sends no shopper data, and
 * mapping a payer out of the cart stays the PROCESSOR's job for a charge that carries no such id
 * (`providers/psp/customer/customer.handler.ts`).
 */
export interface UnzerSubmitResult {
  submitResponse?: {
    success?: boolean;
    status?: string;
    data?: { id?: string };
  };
  /**
   * The customer resource the element's own form created or updated at submit time (its
   * `POST`/`PUT /v1/customers` under the PUBLIC key). Only its ID is read, and the processor charges that
   * customer as-is — the browser still creates nothing of the connector's own and names no shopper. It matters
   * because that resource carries the DATE OF BIRTH the shopper typed, which `getCustomerData()` does not
   * return.
   *
   * The wrapper shape is not published, so three plausible positions for the id are read.
   */
  customerResponse?: {
    success?: boolean;
    /** `SUCCESS` | `ERROR` — the vendor's own word for what `success` says as a boolean. */
    status?: string;
    id?: string;
    data?: { id?: string; isError?: boolean };
  };
  threatMetrixId?: string;
}

/**
 * The subset of the `<unzer-payment>` element the components drive. Tokenization is never asked of this
 * element directly: the vendor submits on a click of the button inside `<unzer-checkout>` and reports through
 * that element, which is why no `submit()` is typed here.
 *
 * Every SETTER is optional, and every one of them is called by exactly one place: the customer setters by the
 * base component, the basket setter by the instalment surface, and the wallet setters by their own wallet
 * surface. An SDK that predates any of them exposes none, and a payment must never depend on one.
 */
export interface UnzerPaymentElement extends HTMLElement {
  /**
   * Apple's / Google's own sheet data. A WALLET surface cannot be paid with until it has one of these: the
   * platform sheet is opened by the vendor's own button and it must already know the merchant's identity, the
   * networks, the total and the currency. The processor assembles the object; the surface only passes it on
   *.
   */
  setApplePayData?: (data: Record<string, unknown>) => void | Promise<unknown>;
  setGooglePayData?: (data: Record<string, unknown>) => void | Promise<unknown>;
  /**
   * The purchase's figures: the total in MAJOR units, the currency, and the country. The INSTALMENT surface
   * fetches its plan list from the vendor on mount and that fetch is refused without them.
   */
  setBasketData?: (data: {
    amount: number;
    currencyType: string;
    /** ISO-3166 alpha-2 of the purchase; the instalment plan fetch is refused without it. */
    country?: string;
  }) => void | Promise<unknown>;
  /**
   * The customer data the element's own form collected. Optional because a surface whose SDK predates the
   * customer API exposes none, and a payment must not depend on it: only buy-now-pay-later methods need
   * anything out of it.
   */
  getCustomerData?: () => UnzerCollectedCustomer | undefined;
  /**
   * Prefill the element's own customer form, FIELD BY FIELD. The FALLBACK setter: it writes values into the
   * form and knows nothing about the customer resource, so it can carry neither the merchant reference nor the
   * fields the form does not render, which is why the full loader below is preferred.
   */
  updateCustomerData?: (data: Record<string, unknown>) => void;
  /**
   * The full API-data loader - the setter the customer prefill uses, because only API data becomes
   * part of the customer resource the element writes.
   */
  setCustomerData?: (data: Record<string, unknown>) => void;
}

/**
 * The customer data the vendor form collected, named as the vendor's own SDK names it. These are the values
 * the SHOPPER TYPED — not a customer resource: the PROCESSOR builds the vendor customer, and this hands it the
 * data a commercetools cart cannot carry (no cart has a date of birth, and a guest cart may have no name or
 * address at all).
 */
export interface UnzerCollectedCustomer {
  /** The resource id, present once the element has created or loaded a customer. */
  id?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  salutation?: string;
  birthDate?: string;
  billingAddress?: UnzerCollectedAddress;
  shippingAddress?: UnzerCollectedAddress;
}

/** The vendor customer form's address shape: one street line, `zip`, `city`, `country`. */
export interface UnzerCollectedAddress {
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  state?: string;
}

/**
 * The subset of the `<unzer-checkout>` element the components drive. The button inside it is the ONE
 * submission path: a click makes the vendor validate and tokenize, and the outcome - the resource id, the
 * device-fingerprint id, the customer the vendor form created - arrives through `onPaymentSubmit`. The base
 * component keeps that button hidden and clicks it from `submit()`; the vendor toggles its `disabled` with the
 * form's validity.
 */
export interface UnzerCheckoutElement extends HTMLElement {
  onPaymentSubmit?: (result: UnzerSubmitResult) => void;
}

/**
 * The VENDOR'S OWN VERDICT on the form, carried by `<unzer-payment>`'s `stateChanged` event: `enableCheckout`
 * is its answer to "may this be paid now". It is the only authority on whether a method's fields are filled -
 * the submit control's `disabled`, which the element manages only when it is given one to manage, is not.
 */
export type UnzerPaymentState = { enableCheckout?: boolean };
