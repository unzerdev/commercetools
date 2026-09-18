import type { BrandDefaults, ConfigValidationResult } from '../../../domain';

/** What the generic config layer needs from the active provider: brand defaults and the settings validator. */
export interface ProviderManifest {
  brandDefaults: BrandDefaults;
  validateSettings(rawSettings: unknown): ConfigValidationResult;
}
