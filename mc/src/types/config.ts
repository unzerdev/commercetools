/**
 * Wire shapes of the processor `/operations/store-config` + `/operations/payment-methods` payloads,
 * mirrored HTTP-only. These are hand-kept copies of the processor's provider-owned contracts (the Unzer
 * connection envelope in `domain/contracts/stored-config.ts` and the payment-methods document).
 *
 * The MC app MUST NOT import processor or provider code — a shared import would drag server-only
 * dependencies into the MC bundle and break the app boundary. The processor is the single source of
 * truth; when a shape changes there, mirror it here.
 */

/** The environment a store is configured for - the axis every config surface is scoped by. */
export type StoreMode = 'sandbox' | 'live';

/** A localized text map: language code -> text (mirrors the provider `LocalizedText`). */
export type LocalizedText = Record<string, string>;

/**
 * The processor's redaction sentinel. `GET /operations/store-config` NO LONGER returns it for
 * credentials - those come back in the clear (processor), so the connection screen can show the
 * operator which key pair a store holds. It survives here only as a COMPATIBILITY GUARD: against an
 * older processor that still masks, the form must not treat the mask as a malformed key. Re-sending this
 * exact value on `PUT` still tells the processor to keep the stored secret.
 */
export const REDACTED_SECRET = '***';

/**
 * A per-environment Unzer credential block. Both keys are secret AT REST (AES-256-GCM) but are returned
 * in the clear on read. A present pair means the environment is configured.
 */
export type StoreEnvironmentBlockDto = {
  credentials?: {
    publicKey?: string;
    privateKey?: string;
  };
};

/**
 * The store-config document (the persisted connection envelope). Every field is optional: the Custom
 * Object is an override layer, so `GET` on an unconfigured store returns `{}`. Credentials for both
 * environments may coexist; exactly one `mode` is the active environment per store.
 */
export type StoreConfigDto = {
  mode?: StoreMode;
  environments?: {
    sandbox?: StoreEnvironmentBlockDto;
    live?: StoreEnvironmentBlockDto;
  };
};

/**
 * A currency-keyed amount bag: `{ <ISO-4217 alpha-3>: <minor units> }`. Money is configured PER
 * CURRENCY - the connector converts nothing, so one scalar could only ever be right for one of the
 * store's currencies. A currency absent from the bag carries no limit / no surcharge.
 */
export type CurrencyAmounts = Record<string, number>;

/**
 * A single Unzer payment method's per-store configuration. `paymentMethodCode` comes from Unzer
 * `/v1/keypair`; `name`/`description` are localized per Project language; amounts are currency-keyed
 * ISO-4217 minor units. `bookingMode` applies only to two-step methods; `countries` empty ⇒ all
 * supported.
 *
 * `sendBasketData` is a PERSISTED field (the merchant chooses whether line-item data is sent to the
 * vendor). `supportsAuthorize` and `logo` are READ-ONLY and DERIVED: `GET /operations/payment-methods`
 * carries both per method - the provider's two-step capability the settings modal gates the booking
 * control on, and the logo URL the processor serves for the method code - but the strict `PUT` request
 * rejects a body that carries either, so both are stripped before every save.
 */
export type UnzerMethodConfigDto = {
  paymentMethodCode: string;
  enabled: boolean;
  name: LocalizedText;
  description: LocalizedText;
  bookingMode?: 'charge' | 'authorize';
  minAmount?: CurrencyAmounts;
  maxAmount?: CurrencyAmounts;
  surcharge: CurrencyAmounts;
  countries: string[];
  sendBasketData: boolean;
  /**
   * Whether Click to Pay is offered alongside this method. Meaningful for the CARD method only - the
   * vendor exposes it as a second affordance on the same payment type, not as a method of its own.
   */
  clickToPayEnabled?: boolean;
  /**
   * Google Pay's merchant identity and button, for the GOOGLE PAY method only. Everything the connector can
   * derive is derived and absent from here: the gateway merchant id is the Unzer channel, and the amount,
   * currency and country come off the shopper's cart. An absent field falls back to the vendor's own default.
   */
  googlePay?: GooglePayMethodConfigDto;
  /** Apple Pay's shopper-visible details, for the APPLE PAY method only. */
  applePay?: ApplePayMethodConfigDto;
  /**
   * READ-ONLY capabilities from the GET view; never persisted (absent from the PUT request DTO). The
   * booking-mode control is offered only when the method accepts BOTH kinds - a method the vendor charges
   * one way cannot be booked the other, whatever a merchant picks.
   */
  supportsAuthorize?: boolean;
  supportsCharge?: boolean;
  /**
   * READ-ONLY: the method's logo URL, served by the processor and built from the method CODE. Rendered,
   * never saved - the strict PUT rejects a body carrying it, so it is stripped before a save.
   */
  logo?: string;
  /**
   * READ-ONLY: the card networks the VENDOR serves this method for, in the surface's own spelling. The wallet
   * settings offer exactly these, so a merchant cannot pick a network the account cannot be charged on. Derived
   * from the keypair; stripped before every save like the two above.
   */
  vendorCardNetworks?: string[];
  /**
   * READ-ONLY: the vendor's own coverage for this method, off the keypair. It is what the merchant's own
   * `countries` restriction narrows, so the screen can show which markets the account is actually served
   * for instead of letting a merchant enable a country the vendor refuses.
   */
  vendorCountries?: string[];
  vendorCurrencies?: string[];
  /** READ-ONLY: the payer kinds (`B2B` / `B2C`) the account may charge this method for. */
  vendorCustomerTypes?: string[];
  /** READ-ONLY: the vendor channel this method is served through; Google Pay uses it as its gateway id. */
  vendorChannel?: string;
};

/** Google Pay's per-method configuration - the merchant's Console identity plus the vendor button's look. */
export type GooglePayMethodConfigDto = {
  /**
   * Google's GATEWAY MERCHANT ID - the Unzer channel. Never typed by the merchant: the processor reads it off
   * the keypair and stamps it on every save, so this app shows it and sends it back untouched.
   */
  gatewayMerchantId?: string;
  /** The Google Pay & Wallet Console merchant id. Absent ⇒ Google renders the sheet in TEST mode. */
  merchantId?: string;
  /** The merchant name Google renders inside the payment sheet. */
  merchantName?: string;
  /** The country of the Unzer contract; Unzer serves `CH` and `DK` today, and `DK` is the default. */
  countryCode?: 'DK' | 'CH';
  /** In Google's own spelling; the merchant picks from `vendorCardNetworks`, so no closed list lives here. */
  allowedCardNetworks?: string[];
  allowCreditCards?: boolean;
  allowPrepaidCards?: boolean;
  /**
   * The button, as Google's own `ButtonOptions` models it
   * (https://developers.google.com/pay/api/web/reference/request-objects#ButtonOptions).
   */
  buttonColor?: 'default' | 'black' | 'white';
  /** What the button says; absent = Google's `buy`. */
  buttonType?:
    | 'book'
    | 'buy'
    | 'checkout'
    | 'donate'
    | 'order'
    | 'pay'
    | 'plain'
    | 'subscribe';
  buttonSizeMode?: 'static' | 'fill';
};

/** Apple Pay's per-method configuration; the certificate + domain association stay with the storefront. */
export type ApplePayMethodConfigDto = {
  /** In Apple's own spelling; the merchant picks from `vendorCardNetworks`. */
  supportedNetworks?: string[];
  /** The name beside the total in Apple's own sheet; absent falls back to the store's name. */
  label?: string;
};

/** The payment-methods document persisted in `unzer-connector-payment-methods` (plaintext — no secrets). */
export type PaymentMethodsDto = {
  paymentMethods: UnzerMethodConfigDto[];
};

/** Reference data for the config pickers, resolved server-side (store-scoped with project fallback). */
export type StoreReferenceData = {
  languages: string[];
  currencies: string[];
  countries: string[];
};

/** A store the operator may configure. */
export type StoreSummary = {
  key: string;
  name: string;
  /**
   * Set on the ONE entry that is not a commercetools store: the DEFAULT SCOPE (processor), the
   * configuration every never-connected store follows. The processor returns it first; this app renders
   * its own translated label for it instead of the fallback `name`.
   */
  isDefault?: boolean;
};
