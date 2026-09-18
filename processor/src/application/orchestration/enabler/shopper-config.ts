import type { PaymentConfig, PaymentMethodView, ShopperPaymentMethod, WalletData } from '../../../domain';
import {
  buildShopperPrefill,
  cartCustomerType,
  effectiveMethods,
  eligibilityCountry,
  mergeCatalogue,
  methodLogoUrlFor,
  type OrchestrationCtx,
  type OrchestrationDeps,
  resolveAmountLimit,
  resolveLocalized,
  resolveShopperConfig,
  resolveSurcharge,
} from '../shared';

const DEFAULT_LOCALE = 'en';

interface CartEligibility {
  amount: number;
  currencyCode: string;
  countryCode: string | undefined;
  customerType: 'B2B' | 'B2C';
}

/** An empty coverage list is unrestricted; a non-empty one needs a known, listed country. */
function servesCountry(list: string[], countryCode: string | undefined): boolean {
  return list.length === 0 || (countryCode !== undefined && list.includes(countryCode));
}

/** The intersection of what the merchant allows and what the vendor serves for this cart. */
function isCartEligible(method: PaymentMethodView, cart: CartEligibility): boolean {
  if (!method.enabled) {
    return false;
  }
  if (!servesCountry(method.countries, cart.countryCode)) {
    return false;
  }
  const limit = resolveAmountLimit(method, cart.currencyCode);
  if (limit?.min !== undefined && cart.amount < limit.min) {
    return false;
  }
  if (limit?.max !== undefined && cart.amount > limit.max) {
    return false;
  }
  if (!servesCountry(method.vendorCountries, cart.countryCode)) {
    return false;
  }
  if (method.vendorCurrencies.length > 0 && !method.vendorCurrencies.includes(cart.currencyCode)) {
    return false;
  }
  return method.vendorCustomerTypes.length === 0 || method.vendorCustomerTypes.includes(cart.customerType);
}

/**
 * `GET /operations/payment-config`: the vendor public key, the environment and the enabled, cart-eligible
 * methods with their surface traits, plus the payer prefill. Reads the cart once, the catalogue once.
 */
export async function getPaymentConfig(ctx: OrchestrationCtx, deps: OrchestrationDeps): Promise<PaymentConfig> {
  const { ports, provider } = deps;

  const cart = await ports.cartReader.getCart(ports.cartReader.currentCartId());
  const cfg = await resolveShopperConfig(cart, ports.configResolver);
  const catalogue = await provider.introspection.availableMethods(cfg);
  const stored = await ports.paymentMethodsStore.readEffective(cfg.storeKey, cfg.inheritsDefaultScope);

  const locale = cart.locale ?? DEFAULT_LOCALE;
  const currencyCode = cart.totalPrice.currencyCode;
  const eligibility: CartEligibility = {
    amount: cart.totalPrice.centAmount,
    currencyCode,
    countryCode: eligibilityCountry(cart),
    customerType: cartCustomerType(cart),
  };

  const walletOf = (method: PaymentMethodView): { wallet?: WalletData } => {
    const wallet = provider.surface.walletData(method.paymentMethodCode, {
      ...(method.googlePay ? { googlePay: method.googlePay } : {}),
      ...(method.applePay ? { applePay: method.applePay } : {}),
      ...(method.vendorChannel ? { channel: method.vendorChannel } : {}),
      ...(method.vendorCardNetworks.length > 0 ? { cardNetworks: method.vendorCardNetworks } : {}),
      currencyCode,
      amountMinor: cart.totalPrice.centAmount,
      fractionDigits: cart.totalPrice.fractionDigits,
      ...(eligibility.countryCode ? { countryCode: eligibility.countryCode } : {}),
      storeName: cfg.storeKey,
      locale,
    });
    return wallet ? { wallet } : {};
  };

  const logoOf = (code: string): { logo?: string } => {
    const logo = methodLogoUrlFor(code, ctx.env, provider);
    return logo ? { logo } : {};
  };

  const paymentMethods: ShopperPaymentMethod[] = mergeCatalogue(catalogue, effectiveMethods(stored, cfg.mode))
    .filter((method) => isCartEligible(method, eligibility))
    .map((method) => {
      const traits = provider.surface.traits(method.paymentMethodCode);
      return {
        code: method.paymentMethodCode,
        name: resolveLocalized(method.name, locale),
        description: resolveLocalized(method.description, locale),
        surcharge: resolveSurcharge(method, currencyCode),
        requiresCustomerData: traits.requiresCustomerData,
        needsAmountData: traits.needsAmountData,
        rendersOwnPayButton: traits.rendersOwnPayButton,
        ...walletOf(method),
        ...(traits.carriesClickToPay ? { clickToPayEnabled: method.clickToPayEnabled === true } : {}),
        ...logoOf(method.paymentMethodCode),
      };
    });

  const needsCustomerData = paymentMethods.some((method) => method.requiresCustomerData);
  const dateOfBirth =
    needsCustomerData && cart.customerId ? await ports.customerReader.dateOfBirth(cart.customerId) : undefined;
  const heldVendorCustomerId =
    cart.customerId && provider.customers ? await provider.customers.heldCustomerId(cfg, cart.customerId) : undefined;
  const shopper = buildShopperPrefill(cart, dateOfBirth, heldVendorCustomerId);

  return {
    publicKey: provider.config.shopperPublicKey(cfg),
    environment: cfg.mode,
    locale,
    currency: cart.totalPrice.currencyCode,
    fractionDigits: cart.totalPrice.fractionDigits,
    customerType: eligibility.customerType,
    amount: cart.totalPrice.centAmount,
    ...(eligibility.countryCode ? { country: eligibility.countryCode } : {}),
    paymentMethods,
    ...(shopper ? { shopper } : {}),
  };
}
