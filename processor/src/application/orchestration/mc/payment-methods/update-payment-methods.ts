import { ErrorInvalidOperation } from '@commercetools/connect-payments-sdk';
import type {
  PaymentMethodConfig,
  PaymentMethodsObject,
  PersistedPaymentMethodsView,
  StoreConfig,
} from '../../../../domain';
import {
  assertPaymentMethodRules,
  assertStoreKeyNotReserved,
  type OrchestrationDeps,
  targetStoreKey,
} from '../../shared';
import type { UpdatePaymentMethodsCtx } from './update-payment-methods-ctx';

/** Stamp Google Pay's `gatewayMerchantId` from the catalogue channel; best-effort, a browser must not choose it. */
async function withVendorDerivedFields(
  paymentMethods: PaymentMethodConfig[],
  cfg: StoreConfig,
  deps: OrchestrationDeps,
): Promise<PaymentMethodConfig[]> {
  const needsChannel = paymentMethods.some((method) => method.paymentMethodCode.toLowerCase() === 'googlepay');
  if (!needsChannel) {
    return paymentMethods;
  }

  let channel: string | undefined;
  try {
    const catalogue = await deps.provider.introspection.availableMethods(cfg);
    channel = catalogue.find((entry) => entry.code.toLowerCase() === 'googlepay')?.channel;
  } catch {
    return paymentMethods;
  }
  if (!channel) {
    return paymentMethods;
  }

  return paymentMethods.map((method) =>
    method.paymentMethodCode.toLowerCase() === 'googlepay'
      ? { ...method, googlePay: { ...method.googlePay, gatewayMerchantId: channel } }
      : method,
  );
}

/** `PUT /operations/payment-methods`: validate, stamp derived fields, CAS-write one environment's list. */
export async function updatePaymentMethods(
  ctx: UpdatePaymentMethodsCtx,
  deps: OrchestrationDeps,
): Promise<PersistedPaymentMethodsView> {
  assertStoreKeyNotReserved(ctx.storeKey, deps);

  if (!Array.isArray(ctx.body?.paymentMethods)) {
    throw new ErrorInvalidOperation('Invalid payment-methods payload: `paymentMethods` must be an array.');
  }

  assertPaymentMethodRules(ctx.body.paymentMethods);

  const storeKey = targetStoreKey(ctx.storeKey, deps);
  const cfg = await deps.ports.configResolver.resolve(storeKey, ctx.mode);
  const mode = ctx.mode ?? cfg.mode;
  const paymentMethods = await withVendorDerivedFields(ctx.body.paymentMethods, cfg, deps);
  const { value: current, version } = await deps.ports.paymentMethodsStore.readWithVersion(storeKey);

  const toPersist: PaymentMethodsObject = {
    store: storeKey,
    environments: {
      ...current?.environments,
      [mode]: { paymentMethods },
    },
  };

  const written = await deps.ports.paymentMethodsStore.write(storeKey, toPersist, version);
  return { paymentMethods: written.environments[mode]?.paymentMethods ?? [] };
}
