import type { CollectedCustomer } from './collected-customer';

/** The shopper `POST /payments` request. The server resolves surcharge, basket and booking behavior itself. */
export interface PaymentRequest {
  paymentMethodCode: string;
  /** The vendor payment type id the browser tokenized. */
  resourceId: string;
  /** Validated against the return-origin allowlist. */
  returnUrl: string;
  deviceFingerprintId?: string;
  /** Read only when `vendorCustomerId` is absent. */
  collectedCustomer?: CollectedCustomer;
  /** The vendor customer the surface's own form created; the only carrier of the collected date of birth. */
  vendorCustomerId?: string;
  /** BCP-47. */
  locale?: string;
}
