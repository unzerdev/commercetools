/** One environment's persisted connection block. Every `credentials` value and `webhookSecret` are secret leaves. */
export interface StoreEnvironmentBlock {
  credentials?: Record<string, string>;
  host?: string;
  webhookSecret?: string;
  webhookUrl?: string;
  /** The vendor subscription ids the connector registered; server-owned, never sent by the merchant surface. */
  webhookIds?: string[];
}
