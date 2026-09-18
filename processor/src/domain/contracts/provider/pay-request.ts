import type { Address } from './address';
import type { BasketLine } from './basket-line';
import type { BookingMode, Money, Shopper } from '../common';

/** Pay with a browser-tokenized resource: charged or authorized per the method's booking mode. */
export interface PayRequest {
  /** The vendor payment type id the browser tokenized. */
  resourceId: string;
  /** The method code the shopper chose; the provider decides the transaction kind from it. */
  paymentMethodCode: string;
  /** Cart total plus the method surcharge, minor units. */
  amount: Money;
  fractionDigits: number;
  /** The reference the vendor echoes back for reconciliation. */
  paymentRef: string;
  /** The processor's own public return endpoint. */
  returnUrl: string;
  /** The storefront URL the return leg sends the shopper to. */
  shopperReturnUrl?: string;
  /** The CT Payment id, echoed by the vendor as its order reference. */
  orderId: string;
  /** The merchant's preference; the provider books the only kind a method supports regardless. */
  bookingMode?: BookingMode;
  /** Present only when the method's `sendBasketData` is on. */
  basket?: BasketLine[];
  /** The platform customer id; never sent as the vendor's customer id. */
  shopperRef?: string;
  shopper?: Shopper;
  billingAddress?: Address;
  shippingAddress?: Address;
  /** BCP-47. */
  locale?: string;
  /** The vendor customer the checkout surface created, forwarded as the payer. */
  candidateCustomerId?: string;
  /** Opaque device-fingerprint id for the vendor's risk assessment. */
  deviceFingerprintId?: string;
  /** ISO-3166-1 market country. */
  countryCode?: string;
}
