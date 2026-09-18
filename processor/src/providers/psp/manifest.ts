import type { ProviderManifest } from '../../application/handlers';
import brandDefaults from './brand.defaults.json';
import { validatePspConfig } from './config/store-settings.schema';

/** The brand literals the generic config layer must not carry, injected at bootstrap by the composition root. */
export const pspManifest: ProviderManifest = {
  brandDefaults,
  validateSettings: validatePspConfig,
};
