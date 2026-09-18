import { paymentSDK } from '../bootstrap/payment-sdk';
import { withVersionRetry } from './cas-retry';
import { isNotFound } from './errors';

/** What one prune found: the names removed, and the undeclared names left standing. */
export interface PrunedFields {
  removed: string[];
  retained: string[];
}

/**
 * Remove the fields the registered type carries, `declared` does not, and `ownsField` claims for the
 * connector; the SDK's `createOrUpdate` is additive only. A merchant's own field is reported and kept.
 */
export async function pruneUndeclaredFields(
  key: string,
  declared: readonly string[],
  ownsField: (fieldName: string) => boolean,
): Promise<PrunedFields> {
  let result: PrunedFields = { removed: [], retained: [] };
  await withVersionRetry(
    () => paymentSDK.ctAPI.client.types().withKey({ key }).get().execute(),
    async (current) => {
      const undeclared = current.body.fieldDefinitions
        .map((field) => field.name)
        .filter((name) => !declared.includes(name));
      const removable = undeclared.filter((name) => ownsField(name));
      const retained = undeclared.filter((name) => !ownsField(name));
      result = { removed: removable, retained };
      if (removable.length === 0) {
        return;
      }
      await paymentSDK.ctAPI.client
        .types()
        .withKey({ key })
        .post({
          body: {
            version: current.body.version,
            actions: removable.map((fieldName) => ({ action: 'removeFieldDefinition' as const, fieldName })),
          },
        })
        .execute();
    },
  );
  return result;
}

/** Whether a custom type is registered under the key; any other failure propagates. */
export async function typeExists(key: string): Promise<boolean> {
  try {
    await paymentSDK.ctAPI.client.types().withKey({ key }).get().execute();
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export const customTypes = { pruneUndeclaredFields, typeExists };
