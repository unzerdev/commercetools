import type { ProviderModule } from './application/handlers';
import type { CorePorts } from './application/ports';
import type { OrchestrationEnv } from './application/orchestration';
import {
  CartReaderAdapter,
  ConfigResolverAdapter,
  CustomerReaderAdapter,
  OrderReaderAdapter,
  PaymentStoreAdapter,
  PermissionsHealthAdapter,
  ProjectStoreReaderAdapter,
  ProvisioningAdapter,
} from './infrastructure/adapters';
import { getBrand } from './infrastructure/config/brand';
import { getConfig } from './infrastructure/config/config';
import { REQUIRED_CT_SCOPES } from './infrastructure/config/required-scopes';
import { currentPublicOrigin } from './infrastructure/config/public-origin';
import { verifyWebhookUrlToken } from './infrastructure/crypto/crypto';
import { configStore } from './infrastructure/persistence/store-config.repository';
import { markerStore } from './infrastructure/persistence/webhook-marker.repository';
import { paymentMethodsStore } from './infrastructure/persistence/payment-methods.repository';
import { initProviderManifest } from './application/provider-manifest';
import { appLogger } from './infrastructure/bootstrap/payment-sdk';
import { ctServices } from './infrastructure/commercetools';
import { log } from './infrastructure/bootstrap/libs/logger';
import { buildPspModule, pspManifest } from './providers/psp';
import packageJSON from '../package.json';

initProviderManifest(pspManifest);

/** The active provider: the only concrete PSP the processor names. */
export const provider: ProviderModule = buildPspModule(pspManifest.brandDefaults.paymentTypeKey);

/** The commercetools ports bundle over `infrastructure/commercetools`. */
export const ports: CorePorts = {
  configResolver: new ConfigResolverAdapter(),
  configStore,
  paymentMethodsStore,
  projectStoreReader: new ProjectStoreReaderAdapter(),
  markerStore,
  cartReader: new CartReaderAdapter(ctServices.cart),
  customerReader: new CustomerReaderAdapter(),
  paymentStore: new PaymentStoreAdapter(ctServices.payment),
  orderReader: new OrderReaderAdapter(),
  provisioning: new ProvisioningAdapter(),
  permissionsHealth: new PermissionsHealthAdapter(),
  crypto: { verifyWebhookUrlToken },
};

/** The resolved deployment environment, read at registration time so `dotenv` and test overrides are in place. */
export function buildOrchestrationEnv(): OrchestrationEnv {
  const cfg = getConfig();
  return {
    logger: log,
    brand: { paymentInterface: getBrand().paymentInterface },
    // Read per call: the origin is the current request's, known only inside it.
    get returnUrl(): string | undefined {
      const origin = currentPublicOrigin();
      return origin ? `${origin}/return` : undefined;
    },
    ...(cfg.returnFailureUrl ? { returnFailureUrl: cfg.returnFailureUrl } : {}),
    allowedReturnOrigins: cfg.allowedReturnOrigins,
    status: {
      logger: appLogger,
      timeout: cfg.healthCheckTimeout,
      requiredPermissions: [...REQUIRED_CT_SCOPES],
      metadata: {
        name: packageJSON.name,
        description: packageJSON.description,
        '@commercetools/connect-payments-sdk': packageJSON.dependencies['@commercetools/connect-payments-sdk'],
      },
    },
  };
}

export const env: OrchestrationEnv = buildOrchestrationEnv();
