import type { PaymentMethodsStore } from '../../application/ports';
import { DEFAULT_SCOPE_STORE_KEY, type PaymentMethodsObject, type Versioned } from '../../domain';
import { ctClient } from '../commercetools';
import { getBrand } from '../config/brand';

const container = (): string => getBrand().paymentMethodsContainer;

/** The object and its version in one GET. */
export async function readPaymentMethodsWithVersion(storeKey: string): Promise<Versioned<PaymentMethodsObject>> {
  const record = await ctClient.customObjects.find<PaymentMethodsObject>({
    container: container(),
    key: storeKey,
  });

  return record ? { value: record.value, version: record.version } : { value: null, version: undefined };
}

async function readPaymentMethodsObjects(keys: string[]): Promise<Record<string, PaymentMethodsObject>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    return {};
  }

  const records = await ctClient.customObjects.query<PaymentMethodsObject>({
    container: container(),
    where: 'key in :keys',
    vars: { 'var.keys': unique },
    limit: unique.length,
  });

  return Object.fromEntries(records.map((record) => [record.key, record.value]));
}

/** The object the store runs on: its own, else the default scope's when it inherits its credentials too. */
export async function readEffectivePaymentMethods(
  storeKey: string,
  inheritDefaultScope: boolean,
): Promise<PaymentMethodsObject | null> {
  if (!inheritDefaultScope) {
    const { value } = await readPaymentMethodsWithVersion(storeKey);
    return value;
  }
  const objects = await readPaymentMethodsObjects([DEFAULT_SCOPE_STORE_KEY, storeKey]);
  return objects[storeKey] ?? objects[DEFAULT_SCOPE_STORE_KEY] ?? null;
}

export async function writePaymentMethodsObject(
  storeKey: string,
  value: PaymentMethodsObject,
  version?: number,
): Promise<PaymentMethodsObject> {
  const record = await ctClient.customObjects.save<PaymentMethodsObject>({
    container: container(),
    key: storeKey,
    value,
    version,
  });

  return record.value;
}

export async function deletePaymentMethodsObject(storeKey: string, version?: number): Promise<void> {
  await ctClient.customObjects.remove({ container: container(), key: storeKey, version });
}

/** The `PaymentMethodsStore` port over this repository. */
export const paymentMethodsStore: PaymentMethodsStore = {
  readWithVersion: readPaymentMethodsWithVersion,
  readEffective: readEffectivePaymentMethods,
  write: writePaymentMethodsObject,
  delete: deletePaymentMethodsObject,
};
