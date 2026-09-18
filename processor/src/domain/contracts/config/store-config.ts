import type { EnvironmentMode } from '../common';
import type { ConnectorIdentity } from './connector-identity';
import type { EndpointDefaults } from './endpoint-defaults';
import type { TelemetryHeader } from './telemetry-header';

/** The resolved per-store configuration a provider receives on every call. Secrets are already decrypted. */
export interface StoreConfig {
  storeKey: string;
  /** Whether the connection comes from the merchant-authored default scope rather than the store's own. */
  inheritsDefaultScope: boolean;
  /** The active environment; selects the vendor host. */
  mode: EnvironmentMode;
  /** Vendor API host for the active mode. */
  host: string;
  /** The vendor's two fixed hosts; the connect flow probes a non-active environment by overriding `mode`. */
  vendorHosts: { sandbox: string; live: string };
  integrator: string;
  connector: ConnectorIdentity;
  /** Opaque credential bag; only the provider names its keys. */
  credentials: Record<string, string>;
  /** The provider-owned settings document, opaque to the core. */
  settings: unknown;
  telemetry: TelemetryHeader;
  endpoints: EndpointDefaults;
  /** The custom type key the provider stamps on a CT Payment. */
  paymentTypeKey: string;
  /** Hard bound on one vendor call, in milliseconds. */
  requestTimeoutMs: number;
}
