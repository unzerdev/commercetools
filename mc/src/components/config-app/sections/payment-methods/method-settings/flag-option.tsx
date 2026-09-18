/** Flag-led select options for the settings modal's language and country pickers. */

import type { ReactNode } from 'react';
import { components as reactSelectComponents } from 'react-select';
import type { MenuProps } from 'react-select';
import { flags } from '../../../../../assets/flags';

/** Language code → flag country, so a bare locale still resolves to a flag. */
const LANG_COUNTRY: Record<string, string> = {
  en: 'GB',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  nl: 'NL',
  pt: 'PT',
  pl: 'PL',
  da: 'DK',
  sv: 'SE',
  nb: 'NO',
  fi: 'FI',
  cs: 'CZ',
};

/** The bundled SVG flag for a country, or nothing when unmapped (SVG, not emoji: emoji flags do not render on Windows). */
export const flagImage = (country: string, alt: string): ReactNode => {
  const flag = flags[country];
  return flag ? (
    <img className="unzer-option__flag" src={flag} alt={alt} width={22} />
  ) : null;
};

/** An option row: the flag, then its text. */
export const flagOption = (country: string, text: string): ReactNode => (
  <span className="unzer-option">
    {flagImage(country, '')}
    <span className="unzer-option__text">{text}</span>
  </span>
);

/** A locale option: its flag beside the code the Merchant Center itself shows (`en-AR`) - several languages share one flag. */
export const localeOptionLabel = (locale: string): ReactNode => {
  const [lang = '', region] = locale.split(/[-_]/);
  const country = (
    region ||
    LANG_COUNTRY[lang.toLowerCase()] ||
    lang
  ).toUpperCase();
  return flagOption(country, locale);
};

/**
 * A menu that always opens UPWARDS, for the last field in a tall dialog (opening down fell past the
 * dialog's scroll edge). UI Kit hardcodes `menuPlacement="auto"`, so the way through is its `components`
 * override - react-select's `Menu` positions itself from `placement`.
 */
export const MenuAbove = <T,>(props: MenuProps<T, true>) => (
  <reactSelectComponents.Menu {...props} placement="top" />
);
MenuAbove.displayName = 'MenuAbove';
