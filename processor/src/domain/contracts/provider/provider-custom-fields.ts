/** Provider-owned custom fields the core writes verbatim onto the CT Payment; the keys are opaque to the core. */
export interface ProviderCustomFields {
  typeKey: string;
  fields: Record<string, string>;
}
