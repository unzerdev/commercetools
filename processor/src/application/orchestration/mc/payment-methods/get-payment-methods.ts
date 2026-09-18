import type { PaymentMethodsView } from '../../../../domain';
import {
  effectiveMethods,
  mergeCatalogue,
  methodLogoUrlFor,
  type OrchestrationDeps,
  targetStoreKey,
} from '../../shared';
import type { GetPaymentMethodsCtx } from './get-payment-methods-ctx';

/** `GET /operations/payment-methods`: the live catalogue merged with the store's effective config, logos derived. */
export async function getPaymentMethods(
  ctx: GetPaymentMethodsCtx,
  deps: OrchestrationDeps,
): Promise<PaymentMethodsView> {
  const storeKey = targetStoreKey(ctx.storeKey, deps);
  const cfg = await deps.ports.configResolver.resolve(storeKey, ctx.mode);
  const catalogue = await deps.provider.introspection.availableMethods(cfg);
  const persisted = await deps.ports.paymentMethodsStore.readEffective(storeKey, cfg.inheritsDefaultScope);

  const merged = mergeCatalogue(catalogue, effectiveMethods(persisted, cfg.mode));

  return {
    paymentMethods: merged.map((method) => {
      const logo = methodLogoUrlFor(method.paymentMethodCode, ctx.env, deps.provider);
      return logo ? { ...method, logo } : method;
    }),
  };
}
