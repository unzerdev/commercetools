import type { LocalizedText } from '../common';
import type { CustomFieldDefinition } from './custom-field-definition';

/** The commercetools custom type the connector registers on Payments; post-deploy applies it idempotently. */
export interface CustomTypeDeclaration {
  key: string;
  resourceTypeIds: string[];
  name: LocalizedText;
  fieldDefinitions: CustomFieldDefinition[];
}
