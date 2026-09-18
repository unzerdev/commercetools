import type { CustomTypeDeclaration } from '../../domain';
import { paymentStateDeclarations } from '../../domain';
import type { Provisioning } from '../../application/ports';
import { log } from '../bootstrap/libs/logger';
import { ctClient, ctServices } from '../commercetools';

type TypeDraftArg = Parameters<typeof ctServices.customType.createOrUpdate>[0];

/** The declaration as the SDK's `TypeDraft`; the cast bridges the SDK's field-type unions. */
function toTypeDraft(declaration: CustomTypeDeclaration): TypeDraftArg {
  return {
    key: declaration.key,
    name: declaration.name,
    resourceTypeIds: declaration.resourceTypeIds,
    fieldDefinitions: declaration.fieldDefinitions.map((field) => ({
      name: field.name,
      label: field.label,
      required: field.required,
      type: field.type,
      ...(field.inputHint ? { inputHint: field.inputHint } : {}),
    })),
  } as unknown as TypeDraftArg;
}

/** `Provisioning` over the SDK's additive `createOrUpdate`, the field prune and the state writer. */
export class ProvisioningAdapter implements Provisioning {
  public async ensurePaymentType(
    declaration: CustomTypeDeclaration,
    ownsField: (fieldName: string) => boolean,
  ): Promise<void> {
    const type = await ctServices.customType.createOrUpdate(toTypeDraft(declaration));
    log.info('Ensured unified payment custom type via createOrUpdate', { key: declaration.key, id: type.id });

    const { removed, retained } = await ctClient.customTypes.pruneUndeclaredFields(
      declaration.key,
      declaration.fieldDefinitions.map((field) => field.name),
      ownsField,
    );
    if (removed.length > 0) {
      log.info('Removed payment custom-type fields the connector declaration no longer carries', {
        key: declaration.key,
        fieldNames: removed,
      });
    }
    if (retained.length > 0) {
      log.warn('Payment custom type carries fields outside the connector declaration; left in place', {
        key: declaration.key,
        fieldNames: retained,
      });
    }
  }

  public async ensurePaymentStates(): Promise<void> {
    for (const declaration of paymentStateDeclarations) {
      const outcome = await ctClient.states.ensurePaymentState(declaration);
      log.info(`Payment state ${outcome}`, { key: declaration.key });
    }
  }

  public async missingObjects(paymentTypeKey: string): Promise<string[]> {
    const missing: string[] = [];
    if (!(await ctClient.customTypes.typeExists(paymentTypeKey))) {
      missing.push(`payment custom type '${paymentTypeKey}'`);
    }
    for (const declaration of paymentStateDeclarations) {
      if (!(await ctClient.states.stateExists(declaration.key))) {
        missing.push(`payment state '${declaration.key}'`);
      }
    }
    return missing;
  }
}
