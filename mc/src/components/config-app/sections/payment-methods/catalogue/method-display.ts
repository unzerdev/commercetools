import type { IntlShape } from 'react-intl';
import { unzerMethodName } from './method-catalogue';
import { unzerMethodDescription } from './method-descriptions';

/**
 * How a method type is LABELLED on this screen: Unzer's own name for it, or the raw code for a code this
 * catalogue does not know yet (which no operator should have to read, hence the catalogue).
 *
 * FIXED, not the merchant's own name. The `Payment method name` / `Payment method description` fields in
 * the settings modal are the CHECKOUT copy - what the shopper sees, authored per store language and per
 * environment. This screen is where the operator administers methods, so it has to name them the way
 * Unzer does: a renamed method that then reads differently in the list, in the dialog title and between
 * sandbox and live is a method the operator can no longer match against the vendor's own portal or
 * documentation.
 *
 * Shared by the list and the settings modal, so both label a method identically.
 */
export const methodDisplayName = (code: string): string =>
  unzerMethodName(code) ?? code;

/**
 * UNZER's own description of a method type, translated into the language the operator is reading (hence
 * `intl` rather than a locale string). Empty for a code the catalogue does not know.
 *
 * Like the name, it deliberately IGNORES the merchant's own description: this answers "what is this
 * payment method", which is a property of the method and not of a store's configuration of it, so it must
 * read the same whichever environment is selected. Preferring the authored text made it differ between
 * sandbox and live for the same method (one environment configured, the other not), and it also repeated,
 * above the field, the very text the field below was editing.
 */
export const methodVendorDescription = (
  code: string,
  intl: IntlShape
): string => {
  const vendor = unzerMethodDescription(code);
  return vendor ? intl.formatMessage(vendor) : '';
};
