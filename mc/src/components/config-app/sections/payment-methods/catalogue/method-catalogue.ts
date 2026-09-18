/**
 * What Unzer knows about each payment-method type, keyed by the code the keypair catalogue returns
 * (`availablePaymentTypes` → the connector's `paymentMethodCode`): its name, its documentation page,
 * whether it can only be charged (or only authorized), and whether the vendor requires a basket with the
 * payment. The operator-facing DESCRIPTION lives beside it in `method-descriptions`, as translatable
 * messages rather than fixed strings.
 *
 * None of it is derivable: `paylater-invoice` is "Unzer Invoice", documented at `/payment-methods/invoice/`,
 * authorize-only, and refuses a payment without a basket. Getting any of it wrong is not cosmetic - an
 * unsupported booking mode is rejected at the vendor, and a missing basket fails the payment.
 *
 * A method the merchant has renamed keeps their own name; these are the DEFAULTS. A code missing from
 * here - one Unzer adds after this release - still renders, under its raw code, with both booking modes
 * offered and the basket toggle shown, because nothing here can claim otherwise.
 *
 * Keys are LOWERCASE and matched case-insensitively: Unzer spells one code `EPS` and the rest lowercase.
 */

/** Which booking modes the vendor supports for a method: one of the two, or the merchant's choice. */
export type MethodBookingMode = 'charge' | 'authorize' | 'both';

export interface UnzerMethodDescriptor {
  /** The method's name as Unzer writes it in the portal and the documentation. */
  name: string;
  /** The method's own documentation page. */
  docsUrl: string;
  /** The booking mode(s) the vendor supports - `both` is the only case the merchant gets a choice. */
  bookingMode: MethodBookingMode;
  /**
   * Whether the vendor REQUIRES the basket (line items) with the payment. For these the connector always
   * sends it and the screen offers no toggle: turning it off would simply break the payment.
   */
  requiresBasket: boolean;
}

const DOCS_BASE = 'https://docs.unzer.com/payment-methods';

/** Build a descriptor; `slug` is the documentation path, which matches neither the code nor the name. */
const method = (
  name: string,
  slug: string,
  bookingMode: MethodBookingMode,
  requiresBasket = false
): UnzerMethodDescriptor => ({
  name,
  docsUrl: `${DOCS_BASE}/${slug}/`,
  bookingMode,
  requiresBasket,
});

export const UNZER_METHODS: Record<string, UnzerMethodDescriptor> = {
  alipay: method('Alipay', 'alipay', 'charge'),
  applepay: method('Apple Pay', 'applepay', 'both'),
  bancontact: method('Bancontact', 'bancontact', 'charge'),
  card: method('Cards and Click to Pay', 'card', 'both'),
  eps: method('EPS', 'eps', 'charge'),
  googlepay: method('Google Pay', 'googlepay', 'both'),
  ideal: method('iDEAL | Wero', 'ideal', 'charge'),
  klarna: method('Klarna', 'klarna', 'authorize', true),
  'openbanking-pis': method(
    'Direct Bank Transfer',
    'direct-bank-transfer',
    'charge'
  ),
  'paylater-direct-debit': method(
    'Unzer Direct Debit',
    'direct-debit',
    'authorize',
    true
  ),
  'paylater-installment': method(
    'Unzer Installment',
    'installment',
    'authorize',
    true
  ),
  'paylater-invoice': method('Unzer Invoice', 'invoice', 'authorize', true),
  paypal: method('PayPal', 'paypal', 'both'),
  payu: method('PayU', 'payu', 'charge'),
  'post-finance-card': method(
    'Post Finance Card',
    'post-finance-card',
    'charge'
  ),
  'post-finance-efinance': method(
    'Post Finance eFinance',
    'post-finance-efinance',
    'charge'
  ),
  prepayment: method('Unzer Prepayment', 'prepayment', 'charge'),
  przelewy24: method('Przelewy24', 'przelewy24', 'charge'),
  'sepa-direct-debit': method(
    'SEPA Direct Debit',
    'sepa-direct-debit',
    'charge'
  ),
  twint: method('TWINT', 'twint', 'charge'),
  wechatpay: method('WeChat Pay', 'wechat-pay', 'charge'),
  wero: method('Wero', 'wero', 'charge'),
};

/** The one method that carries Click to Pay, which the merchant enables separately from the method. */
export const CLICK_TO_PAY_METHOD_CODE = 'card';

/**
 * The two WALLET codes. Each carries its own settings block - the merchant's Google Pay Console identity, or
 * Apple's sheet details - and the settings screen renders each block on its own method only.
 */
export const GOOGLE_PAY_METHOD_CODE = 'googlepay';
export const APPLE_PAY_METHOD_CODE = 'applepay';

/** The documentation root - where a code this catalogue does not know sends the operator. */
export const UNZER_DOCS_URL = 'https://docs.unzer.com/';

/** Unzer's booking-mode matrix: which methods support charge, authorize, or both. */
export const BOOKING_MODES_DOCS_URL =
  'https://docs.unzer.com/payment-methods/#supported-booking-modes-for-various-payment-methods';

const descriptorFor = (code: string): UnzerMethodDescriptor | undefined =>
  UNZER_METHODS[code.toLowerCase()];

/** Unzer's name for a method type, or `undefined` for a code this catalogue does not know. */
export const unzerMethodName = (code: string): string | undefined =>
  descriptorFor(code)?.name;

/** The method type's own documentation page, falling back to the documentation root. */
export const unzerMethodDocsUrl = (code: string): string =>
  descriptorFor(code)?.docsUrl ?? UNZER_DOCS_URL;

/**
 * The booking mode(s) the vendor supports. An UNKNOWN code answers `both`: the screen then offers the
 * choice rather than silently forcing a mode the connector only guessed at.
 */
export const unzerMethodBookingMode = (code: string): MethodBookingMode =>
  descriptorFor(code)?.bookingMode ?? 'both';

/**
 * Whether the vendor requires the basket for this method. An UNKNOWN code answers `false`: the screen
 * shows the toggle and the merchant decides, instead of forcing a basket the vendor may not want.
 */
export const unzerMethodRequiresBasket = (code: string): boolean =>
  descriptorFor(code)?.requiresBasket ?? false;
