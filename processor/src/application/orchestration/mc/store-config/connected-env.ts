import type { EnvironmentMode, StoreConfig } from '../../../../domain';

/** One environment connected in this request, with what a rotation needs to drop the previous account's subscription. */
export interface ConnectedEnv {
  mode: EnvironmentMode;
  cfg: StoreConfig;
  /** Present on a rotation: the outgoing account's config, which authenticates its subscription delete. */
  previousCfg?: StoreConfig;
  previousWebhookIds?: string[];
  /** The subscription ids the vendor just created. */
  webhookIds?: string[];
}
