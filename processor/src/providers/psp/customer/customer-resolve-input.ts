import type { Address, Shopper } from '../../../domain';

/** Everything the customer resolution needs from the pay request. */
export interface CustomerResolveInput {
  /** The platform's customer id, absent for a guest; it composes the merchant-side reference, never the vendor id. */
  shopperRef?: string;
  shopper?: Shopper;
  billingAddress?: Address;
  shippingAddress?: Address;
  /** BCP-47; its primary subtag becomes the customer's language. */
  locale?: string;
  /** The vendor customer the checkout surface created, forwarded as-is: the only carrier of the birthdate the element collects. */
  candidateCustomerId?: string;
}
