import type { CustomFieldDefinition } from '../contracts';

/** The CT Payment custom field the webhook reconciler locates the payment by; the vendor echoes it. */
export const PAYMENT_MERCHANT_REFERENCE_FIELD = 'merchantReference';

/** The CT Payment custom field naming the owning store; scopes the reconciliation lookup. */
export const PAYMENT_STORE_KEY_FIELD = 'storeKey';

/** The CT Payment custom field holding the method surcharge added to the charged amount, minor units. */
export const PAYMENT_SURCHARGE_FIELD = 'pspSurcharge';

/** The boolean CT Payment custom field the `IN_REVIEW` state sets. */
export const PAYMENT_REVIEW_FIELD_NAME = 'inReview';

/** The review field definition, unioned into the provider's payment type at post-deploy. */
export const reviewFieldDefinition: CustomFieldDefinition = {
  name: PAYMENT_REVIEW_FIELD_NAME,
  type: { name: 'Boolean' },
  label: { en: 'Payment held for review' },
  required: false,
};

/** A string custom field off a CT custom-field map; absent, empty or wrong-typed values read as `undefined`. */
export function readStringField(fields: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = fields?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
