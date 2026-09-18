import type {
  ConnectorIdentity,
  EnvironmentMode,
  StoreConfig,
  StoredStoreConfig,
  StoreEnvironmentBlock,
} from '../../domain';
import { deepMerge, DEFAULT_SCOPE_STORE_KEY } from '../../domain';
import packageJSON from '../../../package.json';
import { encryptionKeyConfigured, webhookUrlToken } from '../crypto/crypto';
import { readStoreConfigObject, readStoreConfigObjects } from '../persistence/store-config.repository';
import { getBrand } from './brand';
import { getConfig } from './config';
import { currentPublicOrigin } from './public-origin';
import { resolveStoreKey } from './store-key';

/** The store's webhook capability URL, derived from the public origin and the token the current key mints. */
function derivedWebhookUrl(storeKey: string): string | undefined {
  const origin = currentPublicOrigin();
  if (!origin || !encryptionKeyConfigured()) {
    return undefined;
  }
  return `${origin}/webhooks/${encodeURIComponent(storeKey)}/${webhookUrlToken(storeKey)}`;
}

interface MergeLayer {
  mode?: EnvironmentMode;
  environments?: { sandbox?: StoreEnvironmentBlock; live?: StoreEnvironmentBlock };
  settings?: unknown;
}

function toLayer(entry: Partial<StoredStoreConfig> | null | undefined): MergeLayer {
  const layer: MergeLayer = {};
  if (entry?.settings !== undefined) {
    layer.settings = entry.settings;
  }
  if (entry?.mode !== undefined) {
    layer.mode = entry.mode;
  }
  if (entry?.environments !== undefined) {
    layer.environments = entry.environments;
  }
  return layer;
}

/** The shared resolution tail both paths run: pick the active environment, take its credentials, apply brand identity. */
function assembleStoreConfig(
  storeKey: string,
  merged: MergeLayer,
  modeOverride?: EnvironmentMode,
  inheritsDefaultScope = true,
): StoreConfig {
  const mode: EnvironmentMode = modeOverride ?? merged.mode ?? 'sandbox';
  const activeEnvironment: StoreEnvironmentBlock = merged.environments?.[mode] ?? {};

  const credentials: Record<string, string> = { ...(activeEnvironment.credentials ?? {}) };

  const brand = getBrand();
  const connector: ConnectorIdentity = {
    creator: packageJSON.author,
    name: brand.telemetry.shoppingCartExtension,
    version: packageJSON.version,
  };
  return {
    storeKey,
    inheritsDefaultScope,
    mode,
    host: activeEnvironment.host || (mode === 'live' ? brand.endpoints.defaultHostLive : brand.endpoints.defaultHost),
    vendorHosts: { sandbox: brand.endpoints.defaultHost, live: brand.endpoints.defaultHostLive },
    integrator: brand.telemetry.integrator,
    credentials,
    settings: merged.settings,
    connector,
    telemetry: { name: brand.telemetryHeaderName },
    endpoints: {
      webhookUrl: activeEnvironment.webhookUrl || derivedWebhookUrl(storeKey),
      backOfficeBaseUrl: brand.endpoints.backOffice?.[mode],
    },
    requestTimeoutMs: getConfig().requestTimeoutMs,
    paymentTypeKey: brand.paymentTypeKey,
  };
}

/** Deep-merge the default-scope object and the store's own object, highest last. */
export const resolveStoreConfig = async (storeKey: string, modeOverride?: EnvironmentMode): Promise<StoreConfig> => {
  const objects = await readStoreConfigObjects([DEFAULT_SCOPE_STORE_KEY, storeKey]);

  let merged: MergeLayer = {};
  merged = deepMerge(merged, toLayer(objects[DEFAULT_SCOPE_STORE_KEY])) as MergeLayer;
  merged = deepMerge(merged, toLayer(objects[storeKey])) as MergeLayer;

  return assembleStoreConfig(storeKey, merged, modeOverride, objects[storeKey] === undefined);
};

/** The no-store default: the default scope alone, labelled with the project key so later legs can resolve it. */
export const resolveDefaultStoreConfig = async (): Promise<StoreConfig> => {
  const defaultScope = await readStoreConfigObject(DEFAULT_SCOPE_STORE_KEY);

  const merged = deepMerge({}, toLayer(defaultScope)) as MergeLayer;

  return assembleStoreConfig(resolveStoreKey(), merged);
};
