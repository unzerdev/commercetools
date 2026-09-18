import type { CartReader } from './cart-reader';
import type { ConfigResolver } from './config-resolver.port';
import type { ConfigStore } from './config-store';
import type { Crypto } from './crypto.port';
import type { CustomerReader } from './customer-reader.port';
import type { Provisioning } from './provisioning.port';
import type { MarkerStore } from './marker-store.port';
import type { OrderReader } from './order-reader';
import type { PaymentMethodsStore } from './payment-methods-store.port';
import type { PaymentStore } from './payment-store';
import type { PermissionsHealth } from './permissions-health.port';
import type { ProjectStoreReader } from './project-store-reader';

/** The commercetools ports bundle the composition root injects into the orchestration. */
export interface CorePorts {
  configResolver: ConfigResolver;
  configStore: ConfigStore;
  paymentMethodsStore: PaymentMethodsStore;
  projectStoreReader: ProjectStoreReader;
  markerStore: MarkerStore;
  cartReader: CartReader;
  customerReader: CustomerReader;
  paymentStore: PaymentStore;
  orderReader: OrderReader;
  provisioning: Provisioning;
  permissionsHealth: PermissionsHealth;
  crypto: Crypto;
}
