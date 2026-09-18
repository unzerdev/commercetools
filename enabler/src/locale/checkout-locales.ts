/**
 * The display locales this connector's browser surfaces can be handed, and how a requested one is
 * resolved to a code the dictionaries actually carry.
 *
 * The set is commercetools Checkout's own (docs.commercetools.com/checkout/installing-checkout#locales):
 * Checkout reverts anything outside it to `en`, so it is the widest set a Checkout-hosted enabler can
 * ever receive. `en` leads the list deliberately — see step 2 of the chain in `resolveCheckoutLocale`.
 */
export const CHECKOUT_LOCALES = [
  'en',
  'bg-BG',
  'cs-CZ',
  'da-DK',
  'de',
  'el-GR',
  'en-US',
  'es',
  'et-EE',
  'fi-FI',
  'fr',
  'hr-HR',
  'hu',
  'it',
  'lt-LT',
  'lv-LV',
  'nb-NO',
  'nl-NL',
  'pl-PL',
  'pt-PT',
  'ro-RO',
  'sk-SK',
  'sl-SI',
  'sr-RS',
  'sv-SE',
] as const;

/** One of the 25 codes above — the only thing a dictionary is keyed by. */
export type CheckoutLocale = (typeof CHECKOUT_LOCALES)[number];

/** The locale served when the requested one cannot be resolved. */
const FALLBACK_LOCALE: CheckoutLocale = 'en';

/** `de-DE` → `de-DE`, `DE-de` → `de-DE`: primary subtag lowercase, region subtag uppercase. */
function normalize(requested: string): string {
  const [language, region] = requested.trim().split(/[-_]/);
  const lower = (language ?? '').toLowerCase();
  return region ? `${lower}-${region.toUpperCase()}` : lower;
}

/**
 * Resolve a requested locale to a carried one, in three steps:
 *
 *   1. the exact normalized code;
 *   2. the FIRST carried code with the same primary subtag — the step that maps a request the table
 *      holds under a different region, in either direction (`de-DE` → `de`, `sr` → `sr-RS`,
 *      `pt-BR` → `pt-PT`), and the reason `en` precedes `en-US` in the list, so `en-GB` → `en`;
 *   3. `en`.
 *
 * Never throws. A display language is not a correctness condition of a payment, so an unknown locale
 * renders English rather than failing a checkout.
 */
export function resolveCheckoutLocale(requested?: string): CheckoutLocale {
  if (!requested) {
    return FALLBACK_LOCALE;
  }
  const normalized = normalize(requested);
  if (normalized === '') {
    return FALLBACK_LOCALE;
  }
  const exact = CHECKOUT_LOCALES.find((locale) => locale === normalized);
  if (exact) {
    return exact;
  }
  const primary = normalized.split('-')[0];
  return CHECKOUT_LOCALES.find((locale) => locale.split('-')[0] === primary) ?? FALLBACK_LOCALE;
}

/**
 * Substitute `{name}` placeholders. A parameter the template does not name is ignored, and a
 * placeholder the caller did not supply is LEFT AS IS rather than blanked — a visibly wrong string is
 * a bug someone fixes, whereas a silently empty one reads as a design.
 */
export function formatText(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), template);
}
