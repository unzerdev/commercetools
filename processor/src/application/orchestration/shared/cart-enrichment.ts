import type { Cart, Address as CtAddress } from '@commercetools/connect-payments-sdk';
import type { Address, Shopper } from '../../../domain';

/** The payer as the cart describes it, for the provider's own customer resource. */
export interface CartEnrichment {
  billingAddress?: Address;
  shippingAddress?: Address;
  shopper?: Shopper;
}

/** The CT address as the PSP-agnostic one, keeping only fields that carry a value; `mobile` never falls back to `phone`. */
export function toAddress(address: CtAddress | undefined): Address | undefined {
  if (!address) {
    return undefined;
  }
  const mapped: Address = {
    ...(address.firstName ? { firstName: address.firstName } : {}),
    ...(address.lastName ? { lastName: address.lastName } : {}),
    ...(address.streetName ? { street: address.streetName } : {}),
    ...(address.streetNumber ? { houseNumber: address.streetNumber } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.country ? { countryCode: address.country } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.company ? { company: address.company } : {}),
    ...((address.phone ?? address.mobile) ? { phone: address.phone ?? address.mobile } : {}),
    ...(address.mobile ? { mobile: address.mobile } : {}),
    ...((address.salutation ?? address.title) ? { salutation: address.salutation ?? address.title } : {}),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/** Billing and shipping addresses plus the shopper identity, from the cart alone. */
export function buildCartEnrichment(cart: Cart): CartEnrichment {
  const billingAddress = toAddress(cart.billingAddress);
  const shippingAddress = toAddress(cart.shippingAddress);

  const nameSource = cart.billingAddress ?? cart.shippingAddress;
  const shopper: Shopper = {
    ...(cart.customerEmail ? { email: cart.customerEmail } : {}),
    ...(nameSource?.firstName ? { firstName: nameSource.firstName } : {}),
    ...(nameSource?.lastName ? { lastName: nameSource.lastName } : {}),
  };

  return {
    ...(billingAddress ? { billingAddress } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
    ...(Object.keys(shopper).length > 0 ? { shopper } : {}),
  };
}

/** The country a method's eligibility is judged against: billing first, the vendor restricts the payer. */
export function eligibilityCountry(cart: Cart): string | undefined {
  return cart.billingAddress?.country ?? cart.country ?? cart.shippingAddress?.country;
}

/** Who is buying: a company on the billing address makes it `B2B`. */
export function cartCustomerType(cart: Cart): 'B2B' | 'B2C' {
  return cart.billingAddress?.company ? 'B2B' : 'B2C';
}

/** The cart's market country for what the vendor is told about the order: the cart's own first. */
export function cartCountry(cart: Cart): string | undefined {
  return cart.country ?? cart.billingAddress?.country ?? cart.shippingAddress?.country;
}
