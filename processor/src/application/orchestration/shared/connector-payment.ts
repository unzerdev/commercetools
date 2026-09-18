import { PAYMENT_STORE_KEY_FIELD, readStringField } from '../../../domain';
import type { Payment } from '../../ports';

/** The store the payment was created under; absent on any payment this connector did not create. */
export function connectorStoreKey(payment: Payment): string | undefined {
  return readStringField(payment.custom?.fields, PAYMENT_STORE_KEY_FIELD);
}
