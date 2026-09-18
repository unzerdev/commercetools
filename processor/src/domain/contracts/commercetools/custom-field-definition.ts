import type { LocalizedText } from '../common';
import type { CustomFieldType } from './custom-field-type';

/** One field on a commercetools custom type. */
export interface CustomFieldDefinition {
  name: string;
  type: CustomFieldType;
  label: LocalizedText;
  required: boolean;
  inputHint?: 'SingleLine' | 'MultiLine';
}
