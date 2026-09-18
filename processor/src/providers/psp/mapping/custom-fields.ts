import type { ProviderCustomFields } from '../../../domain';
import { PAYMENT_MERCHANT_REFERENCE_FIELD } from '../../../domain';

/** The provider's own field names on the CT Payment custom type. */
export const PSP_PAYMENT_ID_FIELD = 'pspPaymentId';
export const PSP_SHOPPER_RETURN_URL_FIELD = 'pspShopperReturnUrl';

/** The provider-owned custom-field carrier the processor writes verbatim; only ids with a value are included. */
export function pspCustomFields(
  ids: { paymentId?: string | null; merchantReference?: string | null; shopperReturnUrl?: string | null },
  typeKey: string,
): ProviderCustomFields {
  const fields: Record<string, string> = {};
  if (ids.paymentId) {
    fields[PSP_PAYMENT_ID_FIELD] = ids.paymentId;
  }
  if (ids.merchantReference) {
    fields[PAYMENT_MERCHANT_REFERENCE_FIELD] = ids.merchantReference;
  }
  if (ids.shopperReturnUrl) {
    fields[PSP_SHOPPER_RETURN_URL_FIELD] = ids.shopperReturnUrl;
  }
  return { typeKey, fields };
}
