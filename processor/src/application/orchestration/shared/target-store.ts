import { ErrorInvalidOperation } from '@commercetools/connect-payments-sdk';
import type { Cart } from '@commercetools/connect-payments-sdk';
import type { StoreConfig } from '../../../domain';
import type { ConfigResolver, Payment } from '../../ports';
import { connectorStoreKey } from './connector-payment';
import type { OrchestrationDeps } from './env';

/** The operator message when a merchant write names the reserved project key. */
export const RESERVED_STORE_KEY_MESSAGE =
  'A merchant configuration write must name a real store via the X-Store-Key header. The commercetools ' +
  'project key is reserved and can never hold per-store configuration.';

/** The config a shopper call runs under: the cart's store, else the no-store default. */
export function resolveShopperConfig(cart: Cart, configResolver: ConfigResolver): Promise<StoreConfig> {
  const storeKey = cart.store?.key;
  return storeKey ? configResolver.resolve(storeKey) : configResolver.resolveDefault();
}

/** The config a payment's later legs run under: the store stamped at pay time, else the default. */
export function resolvePaymentConfig(payment: Payment, configResolver: ConfigResolver): Promise<StoreConfig> {
  const storeKey = connectorStoreKey(payment);
  return storeKey ? configResolver.resolve(storeKey) : configResolver.resolveDefault();
}

/** The store a merchant endpoint targets: the explicit `X-Store-Key`, else the deployment store key. */
export function targetStoreKey(explicit: string | undefined, deps: OrchestrationDeps): string {
  return explicit ?? deps.ports.configResolver.storeKey();
}

/** Refuse a merchant write whose effective target is the reserved project key. */
export function assertStoreKeyNotReserved(explicit: string | undefined, deps: OrchestrationDeps): void {
  if (targetStoreKey(explicit, deps) === deps.ports.configResolver.storeKey()) {
    throw new ErrorInvalidOperation(RESERVED_STORE_KEY_MESSAGE);
  }
}
