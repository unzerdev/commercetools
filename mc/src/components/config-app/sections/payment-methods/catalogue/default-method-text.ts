import { unzerMethodName } from './method-catalogue';

/**
 * The text a method's localized NAME and DESCRIPTION start out as, per store language.
 *
 * These are seeded VALUES, not UI chrome: they land in the merchant's own editable fields and travel to
 * the shopper at checkout, so each store language needs its own — and the language set is the STORE's
 * (`languages` from the reference data), which can hold languages this app has no catalogue for. That is
 * why the sentence lives here as a small table instead of as a react-intl message: `intl` formats in the
 * ONE language the operator is reading, and seeding four languages needs four answers at once. A language
 * the table does not cover falls back to English rather than leaving the field blank.
 *
 * The NAME is Unzer's own and is not translated — "PayPal" is PayPal in every language.
 */
const PAY_SECURELY_WITH: Record<string, string> = {
  en: 'Pay securely with',
  de: 'Sicher bezahlen mit',
  es: 'Pague de forma segura con',
  fr: 'Payez en toute sécurité avec',
  pt: 'Pague com segurança com',
  nl: 'Betaal veilig met',
  it: 'Paga in sicurezza con',
  pl: 'Zapłać bezpiecznie za pomocą',
};

/** The lead-in for `locale`, matched on the primary subtag (`de-AT` reads as `de`), else English. */
const leadIn = (locale: string): string =>
  PAY_SECURELY_WITH[locale] ??
  PAY_SECURELY_WITH[locale.split('-')[0]] ??
  PAY_SECURELY_WITH.en;

/** The default display name: Unzer's own name for the method, or its raw code when unknown. */
export const defaultMethodName = (code: string): string =>
  unzerMethodName(code) ?? code;

/** The default description: "Pay securely with <method>", in the store language it is seeded for. */
export const defaultMethodDescription = (
  code: string,
  locale: string
): string => `${leadIn(locale)} ${defaultMethodName(code)}`;
