import type { CustomTypeDeclaration } from '../../../domain';
import {
  PAYMENT_MERCHANT_REFERENCE_FIELD,
  PAYMENT_REVIEW_FIELD_NAME,
  PAYMENT_STORE_KEY_FIELD,
  PAYMENT_SURCHARGE_FIELD,
  reviewFieldDefinition,
} from '../../../domain';
import type { ProviderModule } from '../../handlers';
import type { OrchestrationDeps } from './env';

/** The connector's own field names on the payment type that are not provider-prefixed. */
const AGNOSTIC_PAYMENT_FIELD_NAMES: readonly string[] = [
  PAYMENT_MERCHANT_REFERENCE_FIELD,
  PAYMENT_STORE_KEY_FIELD,
  PAYMENT_SURCHARGE_FIELD,
  PAYMENT_REVIEW_FIELD_NAME,
];

/** Whether a field on the registered type is the connector's to remove: provider-prefixed camelCase, or one of ours. */
export function ownsPaymentField(providerKey: string, fieldName: string): boolean {
  const prefixed = fieldName.startsWith(providerKey) && /^[A-Z]/.test(fieldName.charAt(providerKey.length));
  return prefixed || AGNOSTIC_PAYMENT_FIELD_NAMES.includes(fieldName);
}

/** The single payment custom type: the provider's fields unioned with the connector's review field. */
export function unifiedPaymentType(provider: ProviderModule): CustomTypeDeclaration {
  return {
    key: provider.paymentCustomType.key,
    name: provider.paymentCustomType.name,
    resourceTypeIds: provider.paymentCustomType.resourceTypeIds,
    fieldDefinitions: [...provider.paymentCustomType.fieldDefinitions, reviewFieldDefinition],
  };
}

/**
 * Provision what the connector owns in commercetools - the payment custom type and the payment states -
 * from the merchant action that precedes every payment: saving a store connection. Idempotent, so a
 * re-save is a no-op, and it runs before the connection is persisted so a failure leaves nothing half-done.
 */
export async function ensureConnectorObjects(deps: OrchestrationDeps): Promise<void> {
  const { provider, ports } = deps;
  await ports.provisioning.ensurePaymentType(unifiedPaymentType(provider), (fieldName) =>
    ownsPaymentField(provider.key, fieldName),
  );
  await ports.provisioning.ensurePaymentStates();
}
