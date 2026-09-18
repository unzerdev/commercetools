import type { PaymentMethodConfig } from '../../../domain';

/** The method's order-amount window for one currency, or `undefined` when none is configured for it. */
export function resolveAmountLimit(
  method: PaymentMethodConfig,
  currencyCode: string,
): { min?: number; max?: number } | undefined {
  const min = method.minAmount?.[currencyCode];
  const max = method.maxAmount?.[currencyCode];
  if (min === undefined && max === undefined) {
    return undefined;
  }
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** The method's surcharge for one currency, or `0`; never a figure borrowed from another currency. */
export function resolveSurcharge(method: PaymentMethodConfig, currencyCode: string): number {
  return method.surcharge?.[currencyCode] ?? 0;
}
