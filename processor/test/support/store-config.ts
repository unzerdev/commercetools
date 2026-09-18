/**
 * Test support: a `StoreConfig` factory for the built-in `psp` provider. Tests exercise the real
 * `providers/psp` code by driving the Unzer client funnel through injected fakes — there is no
 * parallel mock provider: this distribution ships one concrete provider and no simulator.
 */
import type { StoreConfig } from '../../src/domain';
import { pspManifest } from '../../src/providers/psp';

/** The vendor sandbox host, taken from the active manifest so no brand literal lives in the suite. */
export const HOST = pspManifest.brandDefaults.defaultHost;
export const MERCHANT_ID = 'MERCHANT123';

/** The back-office base URL config resolves for a store in test mode (`resolveStoreConfig`). */
export const BACK_OFFICE_BASE = 'https://merchant-portal.example.test';

/** A resolved per-store config for tests (tier (a) shape). */
export function storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    storeKey: 'main',
    // The ordinary case: a store CONNECTED on its own account, inheriting nothing from the default scope.
    inheritsDefaultScope: false,
    mode: 'sandbox',
    host: HOST,
    vendorHosts: { sandbox: HOST, live: pspManifest.brandDefaults.defaultHostLive },
    integrator: 'Logeecom',
    connector: { creator: 'Logeecom', name: 'test-commercetools', version: '0.0.0-test' },
    credentials: {
      apiKeyId: 'test-api-key-id',
      apiSecret: 'test-api-secret',
      merchantId: MERCHANT_ID,
    },
    // The opaque provider settings document — empty: this connector has no provider-owned settings.
    settings: {},
    telemetry: { name: pspManifest.brandDefaults.telemetryHeaderName },
    endpoints: {
      backOfficeBaseUrl: BACK_OFFICE_BASE,
    },
    requestTimeoutMs: 30000,
    paymentTypeKey: 'psp-payment',
    ...overrides,
  };
}
