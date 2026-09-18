import type { Address } from '../../../domain';
import type { UnzerAddress, UnzerCompanyInfo, UnzerCustomer, UnzerShippingAddress } from '../client';
import type { CustomerResolveInput } from './customer-resolve-input';

/**
 * The vendor customer body from the cart, or `undefined` when it carries no name (the vendor's only mandatory
 * fields). The billing address decides the company, so a cart without one can turn B2B off.
 */
export function toUnzerCustomer(input: CustomerResolveInput): UnzerCustomer | undefined {
  const firstname = input.shopper?.firstName ?? input.billingAddress?.firstName;
  const lastname = input.shopper?.lastName ?? input.billingAddress?.lastName;
  if (!firstname || !lastname) {
    return undefined;
  }

  const email = input.shopper?.email;
  const billing = toUnzerAddress(input.billingAddress, firstname, lastname);
  const shippingSource = input.shippingAddress ?? input.billingAddress;
  const shipping: UnzerShippingAddress | undefined = toUnzerAddress(shippingSource, firstname, lastname);
  const language = input.locale?.split(/[-_]/)[0];
  const birthDate = toBirthDate(input.shopper?.dateOfBirth);
  const company = input.billingAddress?.company;

  return {
    firstname,
    lastname,
    salutation: toSalutation(input.billingAddress?.salutation ?? input.shopper?.salutation),
    ...(email ? { email } : {}),
    ...(input.billingAddress?.phone ? { phone: input.billingAddress.phone } : {}),
    ...(input.billingAddress?.mobile ? { mobile: input.billingAddress.mobile } : {}),
    ...(language ? { language } : {}),
    ...(company ? { company, companyInfo: toCompanyInfo() } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(input.shopperRef ? { customerId: input.shopperRef } : {}),
    ...(billing ? { billingAddress: billing } : {}),
    ...(shipping
      ? {
          shippingAddress: {
            ...shipping,
            shippingType: sameAddress(input.billingAddress, shippingSource) ? 'equals-billing' : 'different-address',
          },
        }
      : {}),
  };
}

/** The least a B2B customer can state when only the company name is known; the vendor's own B2B constants. */
function toCompanyInfo(): UnzerCompanyInfo {
  return { registrationType: 'not_registered', function: 'OWNER', commercialSector: 'OTHER' };
}

/** A platform address onto the vendor's, with the full name as `name`; `undefined` for an empty address. */
function toUnzerAddress(address: Address | undefined, firstname: string, lastname: string): UnzerAddress | undefined {
  if (!address || Object.keys(address).length === 0) {
    return undefined;
  }
  const street = joinStreet(address);
  return {
    name: `${firstname} ${lastname}`,
    ...(street ? { street } : {}),
    ...(address.postalCode ? { zip: address.postalCode } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.countryCode ? { country: address.countryCode } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.company ? { company: address.company } : {}),
  };
}

/** Street name and house number joined once, trimmed and de-duplicated. */
function joinStreet(address: Address): string {
  const parts = [address.street, address.houseNumber]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return [...new Set(parts)].join(' ');
}

/** Whether two addresses are the same destination on the fields the vendor's risk signal compares. */
function sameAddress(billing: Address | undefined, shipping: Address | undefined): boolean {
  if (!billing || !shipping) {
    return true;
  }
  return (
    (billing.firstName ?? '') === (shipping.firstName ?? '') &&
    (billing.lastName ?? '') === (shipping.lastName ?? '') &&
    (billing.city ?? '') === (shipping.city ?? '') &&
    (billing.countryCode ?? '') === (shipping.countryCode ?? '') &&
    joinStreet(billing) === joinStreet(shipping) &&
    (billing.postalCode ?? '') === (shipping.postalCode ?? '')
  );
}

/** The vendor's `mr` / `mrs` / `unknown`, matched by prefix; anything unrecognized is `unknown`. */
function toSalutation(salutation: string | undefined): string {
  const normalized = salutation?.toLowerCase().trim();
  if (!normalized) {
    return 'unknown';
  }
  if (normalized.startsWith('mrs') || normalized.startsWith('ms') || normalized.startsWith('mis')) {
    return 'mrs';
  }
  if (normalized.startsWith('mr')) {
    return 'mr';
  }
  return 'unknown';
}

/** The vendor's `YYYY-MM-DD` from the neutral `YYYYMMDD`; nothing for a malformed value. */
function toBirthDate(dateOfBirth: string | undefined): string | undefined {
  if (!dateOfBirth || !/^\d{8}$/.test(dateOfBirth)) {
    return undefined;
  }
  return `${dateOfBirth.slice(0, 4)}-${dateOfBirth.slice(4, 6)}-${dateOfBirth.slice(6, 8)}`;
}
