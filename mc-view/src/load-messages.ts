import {
  type TMessageTranslations,
  mapLocaleToIntlLocale,
  mergeMessages,
  parseChunkImport,
} from '@commercetools-frontend/i18n';

// The shell re-invokes this loader with the operator's raw locale (e.g. `en-GB`, `de-AT`) on every
// Merchant Center header language change. `core.json` — produced by `npm run extract-intl` from
// every `defineMessages` default — is the English base of every returned catalogue; the matching
// `de/es/fr-FR/pt-BR.json` translation is overlaid on top, so any id a translation misses still
// resolves to English and `MISSING_TRANSLATION` never surfaces. `mapLocaleToIntlLocale` collapses
// every operator locale onto exactly the UI languages the Merchant Center ships.
//
// `appkit-en-gap.json` plugs a vendor hole: the shell renders appkit components (user settings menu)
// whose English text appkit ships ONLY as inline `defaultMessage` — no catalogue — so any operator
// locale other than exactly `en` logs a `MISSING_TRANSLATION` error per render. Application messages
// merge after the appkit catalogues into the same `IntlProvider`, so supplying those ids here silences
// the noise. Values are verbatim copies of the installed appkit dist, pinned by the drift guard in
// `load-messages.spec.ts`.
const getTranslationChunkImport = (intlLocale: string) => {
  switch (intlLocale) {
    case 'de':
      return import(
        /* webpackChunkName: "view-i18n-de" */
        './i18n/data/de.json'
      );
    case 'es':
      return import(
        /* webpackChunkName: "view-i18n-es" */
        './i18n/data/es.json'
      );
    case 'fr-FR':
      return import(
        /* webpackChunkName: "view-i18n-fr-FR" */
        './i18n/data/fr-FR.json'
      );
    case 'pt-BR':
      return import(
        /* webpackChunkName: "view-i18n-pt-BR" */
        './i18n/data/pt-BR.json'
      );
    default:
      return undefined;
  }
};

const loadMessages = async (locale: string): Promise<TMessageTranslations> => {
  try {
    const [appkitGapImport, coreImport, translationImport] = await Promise.all([
      import(
        /* webpackChunkName: "view-i18n" */
        './i18n/data/appkit-en-gap.json'
      ),
      import(
        /* webpackChunkName: "view-i18n" */
        './i18n/data/core.json'
      ),
      getTranslationChunkImport(mapLocaleToIntlLocale(locale)),
    ]);
    return mergeMessages(
      parseChunkImport(appkitGapImport),
      parseChunkImport(coreImport),
      translationImport ? parseChunkImport(translationImport) : {}
    );
  } catch (error) {
    console.warn('Something went wrong while loading the view messages', error);
    return {};
  }
};

export default loadMessages;
