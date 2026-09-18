import type { Cart } from '@commercetools/connect-payments-sdk';
import type { Address, CollectedCustomer, Shopper, ShopperPrefill, ShopperPrefillAddress } from '../../../domain';
import { toAddress } from './cart-enrichment';

/** The postal subset a vendor customer form asks for; `undefined` when the address states none of it. */
function toPrefillAddress(address: Address | undefined): ShopperPrefillAddress | undefined {
  if (!address) {
    return undefined;
  }
  const addressee = [address.firstName, address.lastName].filter(Boolean).join(' ');
  const mapped: ShopperPrefillAddress = {
    ...(addressee ? { name: addressee } : {}),
    ...(address.street ? { street: address.street } : {}),
    ...(address.houseNumber ? { houseNumber: address.houseNumber } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.countryCode ? { countryCode: address.countryCode } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.company ? { company: address.company } : {}),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/** The platform's salutation as one of the three values the vendor form accepts; anything else prefills nothing. */
function toVendorSalutation(salutation: string | undefined): ShopperPrefill['salutation'] | undefined {
  const normalized = salutation?.toLowerCase().trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith('mrs') || normalized.startsWith('ms') || normalized.startsWith('mis')) {
    return 'mrs';
  }
  return normalized.startsWith('mr') ? 'mr' : undefined;
}

/** Everything the platform knows about the payer, for prefilling the vendor form; `undefined` when it knows nothing. */
export function buildShopperPrefill(
  cart: Cart,
  dateOfBirth: string | undefined,
  vendorCustomerId?: string,
): ShopperPrefill | undefined {
  const billing = toAddress(cart.billingAddress);
  const shipping = toAddress(cart.shippingAddress);
  const nameSource = billing ?? shipping;
  const salutation = toVendorSalutation(nameSource?.salutation);
  const billingAddress = toPrefillAddress(billing);
  const shippingAddress = toPrefillAddress(shipping);

  const prefill: ShopperPrefill = {
    ...(cart.customerId ? { customerReference: cart.customerId } : {}),
    ...(vendorCustomerId ? { vendorCustomerId } : {}),
    ...(nameSource?.firstName ? { firstName: nameSource.firstName } : {}),
    ...(nameSource?.lastName ? { lastName: nameSource.lastName } : {}),
    ...(cart.customerEmail ? { email: cart.customerEmail } : {}),
    ...(salutation ? { salutation } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(nameSource?.phone ? { phone: nameSource.phone } : {}),
    ...(nameSource?.mobile ? { mobile: nameSource.mobile } : {}),
    ...(nameSource?.company ? { company: nameSource.company } : {}),
    ...(billingAddress ? { billingAddress } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
  };

  return Object.keys(prefill).length > 0 ? prefill : undefined;
}

/** The cart wins on every field it carries; the collected values fill its gaps. */
export function mergeShopper(
  cartShopper: Shopper | undefined,
  collected: CollectedCustomer | undefined,
  dateOfBirth: string | undefined,
): Shopper {
  const firstName = cartShopper?.firstName ?? collected?.firstName;
  const lastName = cartShopper?.lastName ?? collected?.lastName;
  const email = cartShopper?.email ?? collected?.email;
  return {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(email ? { email } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(collected?.salutation ? { salutation: collected.salutation } : {}),
  };
}
