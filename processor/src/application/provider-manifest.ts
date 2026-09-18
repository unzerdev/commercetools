/**
 * The provider-manifest injection seam - the runtime registry.
 *
 * The generic `config/` layer carries NO vendor literals. Everything that varies by PSP — the brand
 * defaults and which env vars supply the provider's credentials — is described by a
 * `ProviderManifest` that the active provider declares and the composition root injects at bootstrap
 * (`initProviderManifest`). `config/brand.ts` and `config/resolve-store-config.ts` read the manifest
 * at call time, so a branded/whitelabel distribution or a different PSP is a manifest change, not a
 * change to the generic config code.
 *
 * The `ProviderManifest`/`BrandDefaults` INTERFACES live in the provider-facing `application/handlers`
 * barrel (so a provider may import them); this file holds only the runtime singleton and imports the
 * type from there. It imports NOTHING from `providers/*`: the provider fills it from
 * `composition-root.ts` — the only file allowed to name a concrete PSP.
 */
import type { ProviderManifest } from './handlers';

let manifest: ProviderManifest | undefined;

/** Inject the active provider's manifest. Called once by `composition-root.ts` at bootstrap. */
export function initProviderManifest(m: ProviderManifest): void {
  manifest = m;
}

/** The active provider's manifest. Throws if the composition root has not initialized it yet. */
export function getProviderManifest(): ProviderManifest {
  if (!manifest) {
    throw new Error(
      'Provider manifest not initialized (composition-root must call initProviderManifest at bootstrap).',
    );
  }
  return manifest;
}
