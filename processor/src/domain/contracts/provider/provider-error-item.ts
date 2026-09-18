/** One itemized vendor error, normalized to operator-safe fields. */
export interface ProviderErrorItem {
  code?: string;
  message?: string;
  category?: string;
  /** The request field the vendor refused, when it names one. */
  propertyName?: string;
}
