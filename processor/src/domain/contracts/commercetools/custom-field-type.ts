import type { LocalizedText } from '../common';

/** A commercetools custom-field type: `name` is the CT field-type name (`String`, `Boolean`, `Enum`, `Set`...). */
export interface CustomFieldType {
  name: string;
  /** Enum options, for `name: 'Enum'`. */
  values?: { key: string; label: LocalizedText }[];
  /** Inner element type, for `name: 'Set'`. */
  elementType?: CustomFieldType;
}
