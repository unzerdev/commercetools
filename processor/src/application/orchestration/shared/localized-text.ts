import type { LocalizedText } from '../../../domain';

/** Exact locale, else its base language, else the first authored value, else `''` (never the code). */
export function resolveLocalized(text: LocalizedText | undefined, locale?: string): string {
  if (!text) {
    return '';
  }
  if (locale) {
    if (text[locale] !== undefined) {
      return text[locale];
    }
    const baseLanguage = locale.split('-')[0];
    if (text[baseLanguage] !== undefined) {
      return text[baseLanguage];
    }
  }
  return Object.values(text)[0] ?? '';
}
