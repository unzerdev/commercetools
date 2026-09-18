/**
 * Shopper `POST /payments` request/response types, mirroring the processor contract
 * (`processor/src/infrastructure/http/dtos/payment.dto.ts` + the provider contract in
 * `processor/src/application/handlers/provider-module.ts`).
 *
 * A single flat, mode-free contract: the browser tokenizes the instrument through its Unzer UI
 * component and sends the resulting `resourceId`; the processor resolves surcharge, basket and
 * booking behavior from its own config. The browser
 * sends neither the amount nor any basket data: the basket is assembled and created server-side (* withdrew the forwarding path, because the vendor element creates no basket of its own).
 *
 * The enabler only CONSUMES these shapes (it never validates them at runtime), so they are plain
 * TypeScript types — no runtime schema is bundled into the browser build.
 */

/** The customer data a checkout surface collected; mirrors the processor's own `CollectedCustomer`. */
export type CollectedCustomer = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  salutation?: 'mr' | 'mrs' | 'unknown';
  /** `YYYYMMDD`. */
  dateOfBirth?: string;
  billingAddress?: CollectedAddress;
  shippingAddress?: CollectedAddress;
};

/** One collected postal address. */
export type CollectedAddress = {
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  state?: string;
};

/** The `POST /payments` request body: the tokenized `resourceId` and the context the charge needs. */
export type PaymentRequest = {
  /** The chosen method code (a vendor method type from the shopper config). */
  paymentMethodCode: string;
  /** The vendor payment type id produced by the browser tokenization. */
  resourceId?: string;
  /** Shopper storefront return URL, validated server-side against PSP_ALLOWED_RETURN_ORIGINS. */
  returnUrl: string;
  /** Opaque device-fingerprint id from the payment surface, for the provider's risk assessment. */
  deviceFingerprintId?: string;
  /**
   * What the shopper entered in the vendor element's own customer form, for the buy-now-pay-later methods
   * that need a described payer (`paylater-invoice` answers `COR.100.301.112` "Missing element
   * 'Transaction/Customer/Name/Birthdate'" without one). Every other method sends none of it. The processor
   * merges it UNDER the cart — the cart wins wherever it has a value — and prefers this date of birth over
   * the signed-in shopper's stored profile, because it is what was just typed.
   *
   * Sent ONLY when the element reported NO customer of its own: with a `vendorCustomerId` the processor charges
   * that resource and maps nothing, so these values would be read by nobody.
   */
  collectedCustomer?: CollectedCustomer;
  /**
   * The id of the customer the vendor element created at submit time, as a CANDIDATE. That resource carries
   * the date of birth the element does not expose through `getCustomerData()`, and the processor verifies the
   * id with the server credential before using it — refusing one that belongs to a registered shopper.
   */
  vendorCustomerId?: string;
  /** BCP-47 locale. */
  locale?: string;
};

/**
 * The provider follow-up action returned to the enabler — the open discriminated union of
 * `FollowUpAction`. `redirect` carries the hosted-page URL the enabler navigates to (3DS / redirect
 * methods); `none` is a synchronous completion. `sdkAction` / `display` keep the boundary open for
 * non-redirect providers.
 */
export type FollowUpAction =
  | { kind: 'redirect'; payload: { url: string } }
  | { kind: 'sdkAction'; payload: Record<string, unknown> }
  | { kind: 'display'; payload: Record<string, unknown> }
  | { kind: 'none'; payload?: undefined };

/**
 * The `POST /payments` response. `paymentReference` (the CT Payment id) is OPTIONAL to keep the
 * boundary open for provider paths that answer before a CT Payment exists; the flat charge path
 * always carries it alongside the follow-up `action`.
 */
export type PaymentResponse = {
  paymentReference?: string;
  action: FollowUpAction;
};
