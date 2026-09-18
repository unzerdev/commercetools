import type { ProviderEvent, StoreConfig } from '../../domain';

/** Inbound event parsing plus the subscription lifecycle. Authenticity is the core's token gate, not this handler's. */
export interface WebhookHandler {
  /** Reads the authoritative payment from the vendor; the event body is only a pointer. */
  parse(rawBody: Buffer, cfg: StoreConfig): Promise<ProviderEvent>;

  /** Registers the store's subscriptions at `eventUrl` and returns the vendor ids created. */
  registerWebhooks(cfg: StoreConfig, eventUrl: string): Promise<string[]>;

  /** Deletes exactly `ids`, or every subscription on the account when none were recorded. */
  deleteWebhooks(cfg: StoreConfig, ids?: string[]): Promise<void>;
}
