/**
 * The enabler-side mirror of the processor's shopper-facing `GET /operations/payment-config` response
 * (`processor/src/infrastructure/http/dtos/operations/payment-config.dto.ts`). It is SHOPPER-SAFE by
 * construction — it carries the vendor PUBLIC key only, never the private key or any other
 * credential, and no server-only decision field (`bookingMode`, `minAmount`/`maxAmount`,
 * `countries`, `sendBasketData` all stay server-side).
 *
 * The enabler only CONSUMES the config, so these are plain TypeScript types; runtime shaping is done by
 * `parsePaymentConfig`, which fail-softly normalizes an already-authenticated processor body — a sparse
 * body never crashes setup.
 */

/**
 * A single enabled, cart-eligible payment method. `code` is the vendor method type the enabler maps to
 * an Unzer UI element; `name`/`description` arrive already locale-resolved; `surcharge` is an ISO-4217
 * minor-unit non-negative integer the enabler shows next to the method (display only).
 */
export interface PaymentMethodView {
  code: string;
  name: string;
  description: string;
  surcharge: number;
  logo?: string;
  /**
   * Whether this method's charge needs a DESCRIBED CUSTOMER — the buy-now-pay-later family, which the
   * vendor refuses without the payer's name, contact, address and date of birth. The component mounts the
   * vendor's customer form for such a method and prefills it from {@link PaymentConfig.shopper}; the
   * element then requires whatever is still missing. The PROCESSOR decides this, so no vendor method list
   * is hardcoded here.
   */
  requiresCustomerData: boolean;
  /**
   * Whether this method's SURFACE needs the purchase's figures - amount, currency, country - before it can be
   * paid with. True for the instalment surface alone, which fetches its plan list on mount.
   */
  needsAmountData: boolean;
  /**
   * Whether this method's surface draws its OWN pay button - the WALLETS do, and then this component renders
   * none however the host asked.
   */
  rendersOwnPayButton: boolean;
  /**
   * The wallet sheet's data, for a wallet method: `kind` names the vendor setter to call and `payload` is passed
   * to it verbatim. The processor assembled it; nothing here reads inside it.
   */
  wallet?: { kind: 'applepay' | 'googlepay'; payload: Record<string, unknown> };
  /**
   * Whether Click to Pay is offered alongside this method's own form. The processor emits it for the CARD
   * method only — the vendor draws Click to Pay INSIDE the card element's iframe, so it is a second
   * affordance on that surface and never a method of its own.
   *
   * ABSENT means the method cannot carry it and the vendor's own default stands; `false` is the merchant
   * having it switched OFF, which the component turns into the vendor's `disableCTP`. The distinction
   * matters because the vendor default is ON: treating "absent" as "off" would disable an affordance on a
   * surface the flag was never about.
   */
  clickToPayEnabled?: boolean;
}

/** One prefillable address — the postal fields the vendor customer form asks for. */
export interface ShopperPrefillAddress {
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  state?: string;
  /**
   * The addressee's full name. The vendor's address carries ONE `name` field, not a first/last pair, and a
   * business address may be addressed to someone other than the account holder - so it travels per address
   * rather than being composed from the shopper's own name at the last moment.
   */
  name?: string;
  /** The company this address belongs to. Its presence is what makes the customer a BUSINESS one. */
  company?: string;
  /**
   * Where the goods actually go, on the SHIPPING address only - a risk signal the buy-now-pay-later
   * methods read, which is why the vendor enumerates it rather than inferring it from the address.
   */
  shippingType?: 'equals-billing' | 'different-address' | 'branch-pickup' | 'post-office-pickup' | 'pack-station';
}

/**
 * What the platform already knows about the payer, for PREFILLING the vendor customer form so the shopper
 * retypes nothing and is asked only for what is missing. Carries no secret and no platform identifier — it is
 * the shopper's own data, and the processor's schema is strict about that.
 */
export interface ShopperPrefill {
  /**
   * The MERCHANT-SIDE shopper reference (the platform customer id), absent for a guest. It is stamped on the
   * customer the vendor's own form creates, which is what lets the vendor recognise the shopper on their next
   * checkout instead of holding a new customer resource per payment.
   */
  customerReference?: string;
  /**
   * The vendor customer the account ALREADY holds under that reference. Written as the customer's `id` so the
   * element UPDATES that resource; without it the element POSTs a new customer and the vendor refuses it on the
   * shopper's second checkout (`"customerId already exists"`).
   */
  vendorCustomerId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  salutation?: 'mr' | 'mrs' | 'unknown';
  /** `YYYYMMDD`. */
  dateOfBirth?: string;
  phone?: string;
  /**
   * The MOBILE number, separate from `phone`. The vendor refuses Invoice and Installment without one, and
   * a landline in that field satisfies the check with a number that cannot receive what it is sent.
   */
  mobile?: string;
  /**
   * The company the shopper is buying for. Present ⇒ the customer form is switched to B2B, which is a
   * different form with different mandatory fields, not a B2C form with a company name typed into it.
   */
  company?: string;
  billingAddress?: ShopperPrefillAddress;
  shippingAddress?: ShopperPrefillAddress;
}

/** The full shopper-facing payment config the enabler stores on its base options. */
export interface PaymentConfig {
  publicKey: string;
  environment: string;
  locale: string;
  /** The session cart's ISO-4217 currency, used to format a method surcharge for display. */
  currency: string;
  /** The currency's minor-unit exponent, so a minor-unit surcharge renders in major units. */
  fractionDigits: number;
  /**
   * The session cart total in the minor units of {@link currency} - what the vendor element is handed through its
   * own `setBasketData`. WITHOUT any method surcharge; each method carries its own.
   */
  amount: number;
  /** ISO-3166 alpha-2 country of the purchase, when the cart names one - part of the instalment plan fetch. */
  country?: string;
  /**
   * WHO is buying, as the PROCESSOR resolved it from the cart's billing address: `B2B` when it names a company,
   * else `B2C`. The same answer the offered method list was filtered by - the vendor restricts some methods to
   * one kind of payer.
   */
  customerType: 'B2B' | 'B2C';
  paymentMethods: PaymentMethodView[];
  /** Prefill for the vendor customer form; absent when the platform knows nothing about the payer. */
  shopper?: ShopperPrefill;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const asMinorUnits = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

const asFractionDigits = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 2;

/**
 * Normalize a single method entry. Fail-soft: missing/malformed fields default to empty text and a
 * zero surcharge, so the consumer only ever renders a well-formed method view.
 */
/**
 * Whether a wallet block is one this build can act on: a KNOWN kind plus an object payload. An unknown kind
 * names a vendor setter this version cannot call, and a non-object payload is drift the vendor would refuse -
 * both are dropped so the surface mounts and the shopper simply gets no wallet sheet.
 */
const isWalletPayload = (value: unknown): value is PaymentMethodView['wallet'] => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const block = value as { kind?: unknown; payload?: unknown };
  const known = block.kind === 'applepay' || block.kind === 'googlepay';
  return known && typeof block.payload === 'object' && block.payload !== null;
};

const normalizeMethod = (raw: unknown): PaymentMethodView => {
  const method = asRecord(raw);
  return {
    code: asString(method.code),
    name: asString(method.name),
    description: asString(method.description),
    surcharge: asMinorUnits(method.surcharge),
    requiresCustomerData: method.requiresCustomerData === true,
    // Fail-soft to FALSE: a processor that predates the field pushes no figures, which is what this surface did
    // before the field existed.
    needsAmountData: method.needsAmountData === true,
    rendersOwnPayButton: method.rendersOwnPayButton === true,
    // Only a KNOWN kind with an object payload travels: an unknown kind names a setter this build cannot call,
    // and a payload that is not an object is drift the vendor would refuse anyway.
    ...(isWalletPayload(method.wallet) ? { wallet: method.wallet } : {}),
    // Carried through only when the processor stated it: absence is meaningful here (see the field's
    // doc), so a missing flag must not normalize to `false` the way the fail-soft fields above do.
    ...(typeof method.clickToPayEnabled === 'boolean' ? { clickToPayEnabled: method.clickToPayEnabled } : {}),
    ...(typeof method.logo === 'string' ? { logo: method.logo } : {}),
  };
};

type ShippingType = NonNullable<ShopperPrefillAddress['shippingType']>;

/** The five destinations the vendor enumerates; anything else is not a shipping type it can read. */
const SHIPPING_TYPES: readonly ShippingType[] = [
  'equals-billing',
  'different-address',
  'branch-pickup',
  'post-office-pickup',
  'pack-station',
];

/** Copy only the string leaves the vendor form understands; an address with none of them is dropped. */
const normalizeAddress = (raw: unknown): ShopperPrefillAddress | undefined => {
  const address = asRecord(raw);
  const mapped: ShopperPrefillAddress = {};
  for (const key of [
    'street',
    'houseNumber',
    'postalCode',
    'city',
    'countryCode',
    'state',
    'name',
    'company',
  ] as const) {
    if (typeof address[key] === 'string' && address[key] !== '') {
      mapped[key] = address[key] as string;
    }
  }
  // An enumerated value, so an unrecognised one is DROPPED rather than forwarded: the vendor rejects a
  // shipping type it does not know, and refusing the payment over a typo the processor sent is worse than
  // letting the vendor apply its own default.
  if (SHIPPING_TYPES.includes(address.shippingType as ShippingType)) {
    mapped.shippingType = address.shippingType as ShippingType;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

/**
 * Normalize the shopper prefill. Fail-soft like the rest of this parser, and DROPPING is the safe default:
 * a value the processor did not send must not become an empty string, because the vendor form would treat
 * that as an answer and stop asking the shopper for it.
 */
const normalizeShopper = (raw: unknown): ShopperPrefill | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const shopper = asRecord(raw);
  const mapped: ShopperPrefill = {};
  for (const key of [
    'customerReference',
    'vendorCustomerId',
    'firstName',
    'lastName',
    'email',
    'dateOfBirth',
    'phone',
    'mobile',
    'company',
  ] as const) {
    if (typeof shopper[key] === 'string' && shopper[key] !== '') {
      mapped[key] = shopper[key] as string;
    }
  }
  if (shopper.salutation === 'mr' || shopper.salutation === 'mrs' || shopper.salutation === 'unknown') {
    mapped.salutation = shopper.salutation;
  }
  const billing = normalizeAddress(shopper.billingAddress);
  const shipping = normalizeAddress(shopper.shippingAddress);
  if (billing) {
    mapped.billingAddress = billing;
  }
  if (shipping) {
    mapped.shippingAddress = shipping;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

/**
 * Normalize an (already authenticated) processor payment-config body into a `PaymentConfig`.
 * Fail-soft: missing fields default to empty/false and a malformed method list defaults to empty.
 */
export const parsePaymentConfig = (body: unknown): PaymentConfig => {
  const raw = asRecord(body);
  return {
    publicKey: asString(raw.publicKey),
    environment: asString(raw.environment),
    locale: asString(raw.locale),
    currency: asString(raw.currency),
    fractionDigits: asFractionDigits(raw.fractionDigits),
    amount: asMinorUnits(raw.amount),
    ...(typeof raw.country === 'string' && raw.country.length === 2 ? { country: raw.country } : {}),
    // Fail-soft to the PRIVATE kind: a processor that said nothing must not make the purchase a business one.
    customerType: raw.customerType === 'B2B' ? 'B2B' : 'B2C',
    paymentMethods: Array.isArray(raw.paymentMethods) ? raw.paymentMethods.map(normalizeMethod) : [],
    ...(normalizeShopper(raw.shopper) ? { shopper: normalizeShopper(raw.shopper) } : {}),
  };
};
