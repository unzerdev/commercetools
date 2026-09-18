import type { CustomTypeDeclaration } from '../../domain';
import { PAYMENT_MERCHANT_REFERENCE_FIELD, PAYMENT_STORE_KEY_FIELD, PAYMENT_SURCHARGE_FIELD } from '../../domain';
import { PSP_PAYMENT_ID_FIELD, PSP_SHOPPER_RETURN_URL_FIELD } from './mapping';

/**
 * The CT Payment custom type the vendor needs, for the brand's `paymentTypeKey`. It declares only the
 * identifiers a merchant correlates with the back office plus the reconciliation anchors; the lifecycle is
 * the Payment's own Transactions. The review field is unioned into this one type at post-deploy.
 */
export const buildPspPaymentCustomType = (key: string): CustomTypeDeclaration => ({
  key,
  resourceTypeIds: ['payment'],
  name: { en: 'Unzer payment details' },
  fieldDefinitions: [
    {
      name: PSP_PAYMENT_ID_FIELD,
      type: { name: 'String' },
      label: { en: 'Unzer payment id' },
      required: false,
      inputHint: 'SingleLine',
    },
    {
      name: PAYMENT_MERCHANT_REFERENCE_FIELD,
      type: { name: 'String' },
      label: { en: 'Merchant reference' },
      required: false,
      inputHint: 'SingleLine',
    },
    {
      name: PAYMENT_STORE_KEY_FIELD,
      type: { name: 'String' },
      label: { en: 'Owning store key' },
      required: false,
      inputHint: 'SingleLine',
    },
    {
      name: PAYMENT_SURCHARGE_FIELD,
      type: { name: 'String' },
      label: { en: 'Surcharge (minor units)' },
      required: false,
      inputHint: 'SingleLine',
    },
    {
      name: PSP_SHOPPER_RETURN_URL_FIELD,
      type: { name: 'String' },
      label: { en: 'Shopper storefront return URL' },
      required: false,
      inputHint: 'SingleLine',
    },
  ],
});
