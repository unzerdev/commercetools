/**
 * Shared jest setup (runs before every test file, per `jest.config.ts` `setupFiles`).
 *
 * Injects the active provider's manifest into the generic config layer — the same wiring
 * `composition-root.ts` performs at bootstrap — so `getBrand()` / `resolveStoreConfig()` work in
 * every suite (including those that never import the composition root).
 */
import { initProviderManifest } from '../src/application/provider-manifest';
import { pspManifest } from '../src/providers/psp';

initProviderManifest(pspManifest);
