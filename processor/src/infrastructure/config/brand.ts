import type { BrandDefaults } from '../../domain';
import { getProviderManifest } from '../../application/provider-manifest';

/** Brand-varying values resolved from the active provider manifest; no env override exists. */
export interface Brand {
  displayName: string;
  paymentInterface: string;
  telemetryHeaderName: string;
  telemetry: {
    integrator: string;
    shoppingCartExtension: string;
  };
  customObjectContainer: string;
  paymentMethodsContainer: string;
  webhookMarkerContainer: string;
  paymentTypeKey: string;
  managePermission: string;
  endpoints: {
    defaultHost: string;
    defaultHostLive: string;
    backOffice?: { sandbox: string; live: string };
  };
}

export function resolveBrand(d: BrandDefaults): Brand {
  return {
    displayName: d.displayName,
    paymentInterface: d.paymentInterface,
    telemetryHeaderName: d.telemetryHeaderName,
    telemetry: {
      integrator: d.integrator,
      shoppingCartExtension: d.shoppingCartExtension,
    },
    customObjectContainer: d.customObjectContainer,
    paymentMethodsContainer: d.paymentMethodsContainer,
    webhookMarkerContainer: d.webhookMarkerContainer,
    paymentTypeKey: d.paymentTypeKey,
    managePermission: d.managePermission,
    endpoints: {
      defaultHost: d.defaultHost,
      defaultHostLive: d.defaultHostLive,
      ...(d.backOffice ? { backOffice: { sandbox: d.backOffice.test, live: d.backOffice.live } } : {}),
    },
  };
}

/** The active brand, resolved at call time so a module-scope caller can run before the manifest is injected. */
export function getBrand(): Brand {
  return resolveBrand(getProviderManifest().brandDefaults);
}
