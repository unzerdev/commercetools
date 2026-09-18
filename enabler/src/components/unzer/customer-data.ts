/**
 * The CUSTOMER mappings, both directions, as pure functions.
 *
 * Out of the browser: what the vendor's own form collected, lifted into the processor's `collectedCustomer`
 * block, plus the id of the customer resource the element created.
 * Into the element: the whole vendor customer the prefill hands `setCustomerData`.
 *
 * They live apart from the component because none of them touches the DOM, all of them are rules worth
 * reading (and pinning) on their own, and the per-method surfaces share every one of them.
 */
import type { CollectedAddress, CollectedCustomer } from '../../dtos/payment.dto';
import type { ShopperPrefill, ShopperPrefillAddress } from '../../payment-enabler/payment-config';
import type { UnzerCollectedAddress, UnzerCollectedCustomer, UnzerPaymentElement, UnzerSubmitResult } from './elements';

/** The salutations the vendor's customer resource accepts; anything else is dropped rather than sent. */
export const VENDOR_SALUTATIONS = ['mr', 'mrs', 'unknown'] as const;

/**
 * Normalize a collected birth date to the `YYYYMMDD` the processor's request contract carries.
 *
 * Three shapes are accepted because the element formats the field for display and the exact shape depends
 * on the shopper's locale: the vendor API's `YYYY-MM-DD`, an already-compact `YYYYMMDD`, and the
 * day-first `DD.MM.YYYY` its German form renders. Anything else yields `undefined` and the field is
 * omitted — the processor still has its own fallback (the signed-in shopper's commercetools profile), and
 * a guessed date would be refused by the vendor as OUR malformed request instead of as missing input.
 */
export function toCompactBirthDate(value: string | undefined): string | undefined {
  const raw = (value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    return `${iso[1]}${iso[2]}${iso[3]}`;
  }
  if (/^\d{8}$/.test(raw)) {
    return raw;
  }
  const dayFirst = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  return dayFirst ? `${dayFirst[3]}${dayFirst[2]}${dayFirst[1]}` : undefined;
}

/**
 * Lift what the vendor form collected into the processor's `collectedCustomer` block.
 *
 * Only fields the shopper actually filled travel: an empty string is DROPPED, never sent, because the
 * processor merges this under the cart and an empty value would look like an answer. The street line the
 * form collects is one string, so it is sent as `street` and the processor keeps the cart's own house number
 * where it has one. `undefined` when the form yielded nothing at all.
 */
export function toCollectedCustomer(collected: UnzerCollectedCustomer | undefined): CollectedCustomer | undefined {
  if (!collected) {
    return undefined;
  }
  const dateOfBirth = toCompactBirthDate(collected.birthDate);
  const salutation = VENDOR_SALUTATIONS.find((value) => value === collected.salutation);
  const mapped: CollectedCustomer = {
    ...(collected.firstname ? { firstName: collected.firstname } : {}),
    ...(collected.lastname ? { lastName: collected.lastname } : {}),
    ...(collected.email ? { email: collected.email } : {}),
    ...((collected.mobile ?? collected.phone) ? { phone: collected.mobile ?? collected.phone } : {}),
    ...(salutation ? { salutation } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(toCollectedAddress(collected.billingAddress)
      ? { billingAddress: toCollectedAddress(collected.billingAddress) }
      : {}),
    ...(toCollectedAddress(collected.shippingAddress)
      ? { shippingAddress: toCollectedAddress(collected.shippingAddress) }
      : {}),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/** The postal fields the processor's contract carries, from the vendor form's own address shape. */
function toCollectedAddress(address: UnzerCollectedAddress | undefined): CollectedAddress | undefined {
  if (!address) {
    return undefined;
  }
  const mapped: CollectedAddress = {
    ...(address.street ? { street: address.street } : {}),
    ...(address.zip ? { postalCode: address.zip } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.country ? { countryCode: address.country } : {}),
    ...(address.state ? { state: address.state } : {}),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * The id of the customer the vendor element created at submit time, or `undefined` when it created none.
 *
 * ONLY A SUCCESSFUL customer is reported. A failed one carries an id too — an ERROR resource — and the failure
 * that actually happens is the ordinary one: the element POSTs the customer with our merchant reference on it,
 * so the shopper's SECOND checkout comes back `success: false`, `status: "ERROR"`, `"customerId already exists"`.
 * Read without the guard, that error id travelled to the processor as `vendorCustomerId`, was linked as
 * `resources.customerId`, and the vendor refused the charge.
 *
 * Reporting nothing is the correct outcome there, not a loss: the processor then maps the payer from the cart,
 * which reads the customer BY THAT SAME REFERENCE and updates it.
 */
export function toVendorCustomerId(
  result: UnzerSubmitResult,
  paymentEl: UnzerPaymentElement | undefined,
): string | undefined {
  const response = result.customerResponse;
  const reported =
    response?.success === true && response.status?.toUpperCase() !== 'ERROR' && response.data?.isError !== true
      ? (response.id ?? response.data?.id)
      : undefined;
  return usableResourceId(reported) ?? usableResourceId(paymentEl?.getCustomerData?.()?.id);
}

/**
 * A vendor resource id worth sending, or `undefined`. The `s-err-` prefix is the vendor's own marker for an
 * ERROR resource: it is a real id that resolves to a failure, so it must never travel as a customer.
 */
function usableResourceId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed && !trimmed.startsWith('s-err-') ? trimmed : undefined;
}

/** The vendor's own date format for a customer form: `YYYY-MM-DD`, from our compact `YYYYMMDD`. */
function toVendorBirthDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Map a prefill address onto the vendor customer form's address shape (`street`, `zip`, `city`, `country`).
 * The house number joins the street, which is how the vendor models a single street line. An address with
 * nothing usable yields `undefined`, so the form is not prefilled with blanks it would read as answers.
 */
function toVendorAddress(address: ShopperPrefillAddress | undefined): Record<string, string> | undefined {
  if (!address) {
    return undefined;
  }
  const street = [address.street, address.houseNumber].filter(Boolean).join(' ');
  const mapped: Record<string, string> = {
    // `name` is the vendor's own address field and it is ONE string, not a first/last pair. Omitting it
    // left every prefilled address unaddressed, which the buy-now-pay-later methods read as incomplete.
    ...(address.name ? { name: address.name } : {}),
    ...(street ? { street } : {}),
    ...(address.postalCode ? { zip: address.postalCode } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.countryCode ? { country: address.countryCode } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.company ? { company: address.company } : {}),
    ...(address.shippingType ? { shippingType: address.shippingType } : {}),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * The whole vendor CUSTOMER the prefill hands the element, built from the processor's prefill merged with what
 * the host states.
 *
 * THE REFERENCE IS THE POINT. The element creates the vendor customer itself, in the browser, under the public
 * key. Prefilling only the visible form fields left that resource with an EMPTY `customerId`, so the vendor had
 * nothing to recognise the shopper by and every checkout produced a NEW customer resource - and the fields the
 * form does not render (`phone`, `mobile`, `language`) never reached it at all, however carefully they were
 * pushed into the form. Passed as API data they are part of the customer the element writes, and
 * `customerReference` - the platform customer id - is stamped on it, which is the same reference the connector
 * maps a payer under for a charge that carries no such customer. Both paths therefore name ONE
 * customer per shopper. `id` is the resource the account ALREADY holds, so the element updates it rather than
 * creating a second one the vendor would refuse.
 *
 * `customerSettings.type` and `companyInfo` travel in the same object rather than in a second call, because
 * they describe the same resource: a company makes the purchase a BUSINESS one, which is a different form with
 * different mandatory fields. The company itself is decided by WHERE it comes from - `prefill.company` wins
 * whenever the key is PRESENT, empty string included, because a host that states the shopper's company states
 * its absence the same way and an absent company has to be able to turn the switch OFF. The billing address is
 * only a fallback for a host that says nothing at all; reading it unconditionally made a company left on the
 * cart by an earlier visit outlive the shopper deleting it. `companyInfo.owner` mirrors the payer, because for
 * a B2B customer the vendor reads the birthdate THERE and not off the top level.
 *
 * Only the fields the processor actually sent: a value it omitted must NOT be pushed as an empty string,
 * because the element would treat that as an answer and stop asking the shopper for it.
 */
export function toVendorCustomer(prefill: ShopperPrefill, language: string | undefined): Record<string, unknown> {
  const shopperName = [prefill.firstName, prefill.lastName].filter(Boolean).join(' ');
  const withName = (address: ShopperPrefillAddress | undefined): ShopperPrefillAddress | undefined =>
    address && !address.name && shopperName ? { ...address, name: shopperName } : address;

  const company = 'company' in prefill ? prefill.company : prefill.billingAddress?.company;
  const birthDate = toVendorBirthDate(prefill.dateOfBirth);
  const mobile = prefill.mobile ?? prefill.phone;
  const billingAddress = toVendorAddress(withName(prefill.billingAddress));
  const shippingAddress = toVendorAddress(withName(prefill.shippingAddress));

  return {
    ...(prefill.vendorCustomerId ? { id: prefill.vendorCustomerId } : {}),
    ...(prefill.customerReference ? { customerId: prefill.customerReference } : {}),
    ...(prefill.firstName ? { firstname: prefill.firstName } : {}),
    ...(prefill.lastName ? { lastname: prefill.lastName } : {}),
    ...(prefill.email ? { email: prefill.email } : {}),
    ...(prefill.salutation ? { salutation: prefill.salutation } : {}),
    ...(prefill.phone ? { phone: prefill.phone } : {}),
    ...(mobile ? { mobile } : {}),
    ...(language ? { language } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(company ? { company } : {}),
    ...(billingAddress ? { billingAddress } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
    ...(company
      ? {
          companyInfo: {
            registrationType: 'not_registered',
            ...(prefill.firstName || prefill.lastName || birthDate
              ? {
                  owner: {
                    ...(prefill.firstName ? { firstname: prefill.firstName } : {}),
                    ...(prefill.lastName ? { lastname: prefill.lastName } : {}),
                    ...(birthDate ? { birthdate: birthDate } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    customerSettings: { type: company ? 'B2B' : 'B2C' },
  };
}
