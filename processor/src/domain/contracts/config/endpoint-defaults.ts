/** Endpoint defaults resolved for a store. */
export interface EndpointDefaults {
  /** The registered webhook capability URL for this store. */
  webhookUrl?: string;
  /** The vendor back office for the store's active environment; absent when the distribution has none. */
  backOfficeBaseUrl?: string;
}
