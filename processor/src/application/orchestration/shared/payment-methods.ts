import { ErrorInvalidOperation } from '@commercetools/connect-payments-sdk';
import type {
  AvailableMethod,
  CurrencyAmounts,
  EnvironmentMode,
  PaymentMethodConfig,
  PaymentMethodsObject,
  PaymentMethodView,
} from '../../../domain';

/** A disabled default for a catalogue method the merchant has not configured; basket data on, as several methods need it. */
export function defaultMethod(paymentMethodCode: string): PaymentMethodConfig {
  return {
    paymentMethodCode,
    enabled: false,
    name: {},
    description: {},
    surcharge: {},
    countries: [],
    sendBasketData: true,
  };
}

/** A persisted amount field as a currency map; anything else reads as absent, the fail-safe "no limit". */
function currencyAmounts(value: unknown): CurrencyAmounts | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([currency, amount]) => /^[A-Z]{3}$/.test(currency) && Number.isInteger(amount) && (amount as number) >= 0,
    ),
  ) as CurrencyAmounts;
}

function readable(config: PaymentMethodConfig): PaymentMethodConfig {
  return {
    ...config,
    minAmount: currencyAmounts(config.minAmount),
    maxAmount: currencyAmounts(config.maxAmount),
    surcharge: currencyAmounts(config.surcharge) ?? {},
  };
}

/** The list a store runs on for one environment: the Custom Object governs wholesale once it exists, else the env baseline. */
export function effectiveMethods(
  persisted: PaymentMethodsObject | null | undefined,
  mode: EnvironmentMode,
): PaymentMethodConfig[] {
  return persisted?.environments?.[mode]?.paymentMethods ?? [];
}

/** The catalogue merged with the persisted config, in catalogue order; a persisted method absent from the catalogue is dropped. */
export function mergeCatalogue(catalogue: AvailableMethod[], methods: PaymentMethodConfig[]): PaymentMethodView[] {
  const persisted = new Map(methods.map((m) => [m.paymentMethodCode, m]));
  return catalogue.map(
    ({ code, supportsAuthorize, supportsCharge, countries, currencies, customerTypes, channel, cardNetworks }) => ({
      ...readable(persisted.get(code) ?? defaultMethod(code)),
      supportsAuthorize,
      supportsCharge,
      vendorCountries: countries,
      vendorCurrencies: currencies,
      vendorCustomerTypes: customerTypes,
      vendorCardNetworks: cardNetworks,
      ...(channel ? { vendorChannel: channel } : {}),
    }),
  );
}

/** The cross-field rules the schema cannot express: `min <= max` per currency, wallet blocks on their own method only. */
export function assertPaymentMethodRules(paymentMethods: PaymentMethodConfig[]): void {
  for (const method of paymentMethods) {
    for (const [currency, min] of Object.entries(method.minAmount ?? {})) {
      const max = method.maxAmount?.[currency];
      if (max !== undefined && min > max) {
        throw new ErrorInvalidOperation(
          `Invalid payment-methods payload: method '${method.paymentMethodCode}' has minAmount greater than ` +
            `maxAmount for currency '${currency}'.`,
        );
      }
    }
    for (const [field, code] of [
      ['googlePay', 'googlepay'],
      ['applePay', 'applepay'],
    ] as const) {
      if (method[field] !== undefined && method.paymentMethodCode.toLowerCase() !== code) {
        throw new ErrorInvalidOperation(
          `Invalid payment-methods payload: method '${method.paymentMethodCode}' carries a '${field}' block, ` +
            `which belongs to the '${code}' method.`,
        );
      }
    }
  }
}
