import type { WalletData, WalletDataInput } from '../../../domain';
import { toDecimalAmount } from '../client';

const APPLE_PAY_METHOD_CODE = 'applepay';
const GOOGLE_PAY_METHOD_CODE = 'googlepay';

/** Whether a method code is one of the two wallets. */
export function isWalletMethod(code: string): boolean {
  const normalized = code.toLowerCase();
  return normalized === APPLE_PAY_METHOD_CODE || normalized === GOOGLE_PAY_METHOD_CODE;
}

/** The vendor's card-brand names as each wallet's own sheet spells them; a brand neither accepts maps to nothing. */
const WALLET_CARD_NETWORKS: Record<string, { applepay?: string; googlepay?: string }> = {
  MASTER: { applepay: 'masterCard', googlepay: 'MASTERCARD' },
  MASTERCARD: { applepay: 'masterCard', googlepay: 'MASTERCARD' },
  MAESTRO: { applepay: 'maestro' },
  VISA: { applepay: 'visa', googlepay: 'VISA' },
  AMEX: { applepay: 'amex', googlepay: 'AMEX' },
  DISCOVER: { applepay: 'discover', googlepay: 'DISCOVER' },
  JCB: { applepay: 'jcb', googlepay: 'JCB' },
  INTERAC: { googlepay: 'INTERAC' },
};

/** The vendor's brands for one method in that wallet's spelling, deduplicated; `[]` for a non-wallet. */
export function toSurfaceCardNetworks(code: string, brands: string[]): string[] {
  const normalized = code.toLowerCase();
  if (normalized !== APPLE_PAY_METHOD_CODE && normalized !== GOOGLE_PAY_METHOD_CODE) {
    return [];
  }
  const mapped = brands
    .map((brand) => WALLET_CARD_NETWORKS[brand.trim().toUpperCase()]?.[normalized])
    .filter((network): network is string => !!network);
  return [...new Set(mapped)];
}

const APPLE_PAY_MERCHANT_CAPABILITIES = ['supports3DS'] as const;

const GOOGLE_PAY_DEFAULTS = {
  countryCode: 'DK',
  allowCreditCards: true,
  allowPrepaidCards: true,
  buttonColor: 'default',
  buttonType: 'buy',
  buttonSizeMode: 'fill',
} as const;

/** The languages Google renders its own button label in; a shopper locale outside it is left to Google. */
const GOOGLE_PAY_BUTTON_LOCALES: ReadonlySet<string> = new Set([
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'hr',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'th',
  'tr',
  'uk',
  'zh',
]);

function toButtonLocale(cartLocale: string | undefined): string | undefined {
  const primary = cartLocale?.split(/[-_]/)[0]?.toLowerCase();
  return primary && GOOGLE_PAY_BUTTON_LOCALES.has(primary) ? primary : undefined;
}

/**
 * The wallet payload for a method, or `undefined` for a non-wallet. Built on the server because the browser
 * holds no merchant configuration; the amount is the major-unit decimal string both sheets take; the card
 * networks follow the merchant's choice, then the vendor's own brands for the account.
 */
export function buildWalletData(code: string, input: WalletDataInput): WalletData | undefined {
  const amount = toDecimalAmount(input.amountMinor, input.fractionDigits);
  const normalized = code.toLowerCase();

  if (normalized === APPLE_PAY_METHOD_CODE) {
    const configured = input.applePay ?? {};
    const networks = configured.supportedNetworks ?? input.cardNetworks ?? [];
    return {
      kind: 'applepay',
      payload: {
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        currencyCode: input.currencyCode,
        supportedNetworks: networks.map((network) => network.toLowerCase()),
        merchantCapabilities: [...APPLE_PAY_MERCHANT_CAPABILITIES],
        requiredShippingContactFields: [],
        requiredBillingContactFields: [],
        total: { label: configured.label ?? input.storeName ?? '', amount },
      },
    };
  }

  if (normalized === GOOGLE_PAY_METHOD_CODE) {
    const configured = input.googlePay ?? {};
    const buttonLocale = toButtonLocale(input.locale);
    const gatewayMerchantId = configured.gatewayMerchantId ?? input.channel;
    const merchantInfo = {
      ...(configured.merchantId ? { merchantId: configured.merchantId } : {}),
      ...(configured.merchantName ? { merchantName: configured.merchantName } : {}),
    };
    return {
      kind: 'googlepay',
      payload: {
        ...(gatewayMerchantId ? { gatewayMerchantId } : {}),
        ...(Object.keys(merchantInfo).length > 0 ? { merchantInfo } : {}),
        transactionInfo: {
          countryCode: configured.countryCode ?? GOOGLE_PAY_DEFAULTS.countryCode,
          currencyCode: input.currencyCode,
          totalPrice: amount,
        },
        buttonOptions: {
          buttonColor: configured.buttonColor ?? GOOGLE_PAY_DEFAULTS.buttonColor,
          buttonType: configured.buttonType ?? GOOGLE_PAY_DEFAULTS.buttonType,
          buttonSizeMode: configured.buttonSizeMode ?? GOOGLE_PAY_DEFAULTS.buttonSizeMode,
          ...(buttonLocale ? { buttonLocale } : {}),
        },
        allowedCardNetworks: configured.allowedCardNetworks ?? input.cardNetworks ?? [],
        allowCreditCards: configured.allowCreditCards ?? GOOGLE_PAY_DEFAULTS.allowCreditCards,
        allowPrepaidCards: configured.allowPrepaidCards ?? GOOGLE_PAY_DEFAULTS.allowPrepaidCards,
      },
    };
  }

  return undefined;
}
