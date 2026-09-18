import fs from 'fs';
import path from 'path';
import {
  parse,
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';
import loadMessages from '../src/load-messages';
import coreCatalogue from '../src/i18n/data/core.json';
import appkitGapCatalogue from '../src/i18n/data/appkit-en-gap.json';
import deCatalogue from '../src/i18n/data/de.json';
import esCatalogue from '../src/i18n/data/es.json';
import frFRCatalogue from '../src/i18n/data/fr-FR.json';
import ptBRCatalogue from '../src/i18n/data/pt-BR.json';

/**
 * The shell re-invokes the loader with the operator's RAW locale (e.g. `en-GB`, `de-AT`) every time
 * the Merchant Center header language changes, and hands that locale straight to `IntlProvider`
 * while `defaultLocale` stays `en` — so every id missing from the returned catalogue logs a
 * `MISSING_TRANSLATION` console error. Application messages are merged AFTER the appkit/uikit
 * catalogues into the SAME provider, which makes the loader the only place the view can plug vendor
 * gaps:
 *
 * - `core.json` — our own extracted English defaults; the base of every returned catalogue.
 * - `de/es/fr-FR/pt-BR.json` — full translations overlaid on the base for the Merchant Center UI
 *   languages (the shell's `mapLocaleToIntlLocale` collapses every locale onto exactly this set).
 * - `appkit-en-gap.json` — appkit ids the shell renders whose English text appkit does NOT ship in
 *   any catalogue (it lives only as inline `defaultMessage`); values are copied verbatim from the
 *   installed `@commercetools-frontend/application-shell` dist, and the drift guard below fails on
 *   any upgrade that adds, removes, or rewords them.
 */

const load = loadMessages;

const translatedCatalogues: [string, Record<string, string>][] = [
  ['de', deCatalogue],
  ['es', esCatalogue],
  ['fr-FR', frFRCatalogue],
  ['pt-BR', ptBRCatalogue],
];

const collectIcuArguments = (
  elements: MessageFormatElement[],
  args: Set<string>
): Set<string> => {
  elements.forEach((element) => {
    if (
      isArgumentElement(element) ||
      isNumberElement(element) ||
      isDateElement(element) ||
      isTimeElement(element)
    ) {
      args.add(element.value);
    }
    if (isSelectElement(element) || isPluralElement(element)) {
      args.add(element.value);
      Object.values(element.options).forEach((option) =>
        collectIcuArguments(option.value, args)
      );
    }
    if (isTagElement(element)) {
      collectIcuArguments(element.children, args);
    }
  });
  return args;
};

// `parse` also throws on malformed ICU syntax, so this doubles as a syntax check.
const icuArgumentNames = (message: string): string[] =>
  [...collectIcuArguments(parse(message), new Set<string>())].sort();

describe('loadMessages', () => {
  it.each(['en', 'en-GB', 'en-AU'])(
    'returns the English defaults for locale %s',
    async (locale) => {
      const messages = await load(locale);

      Object.entries(coreCatalogue).forEach(([id, defaultText]) => {
        expect(messages[id]).toBe(defaultText);
      });
    }
  );

  describe.each(translatedCatalogues)('locale %s', (locale, catalogue) => {
    it('returns the translated text for every extracted id', async () => {
      const messages = await load(locale);

      Object.entries(catalogue).forEach(([id, translatedText]) => {
        expect(messages[id]).toBe(translatedText);
      });
    });

    it('translates the complete extracted id set', () => {
      expect(Object.keys(catalogue).sort()).toEqual(
        Object.keys(coreCatalogue).sort()
      );
    });

    it('preserves the ICU arguments of every message', () => {
      Object.entries(coreCatalogue).forEach(([id, defaultText]) => {
        expect({ id, args: icuArgumentNames(catalogue[id]) }).toEqual({
          id,
          args: icuArgumentNames(defaultText),
        });
      });
    });
  });

  it.each([
    ['de-AT', deCatalogue],
    ['es-MX', esCatalogue],
    ['fr', frFRCatalogue],
  ])(
    'maps the regional locale %s onto its language catalogue',
    async (locale, catalogue) => {
      const messages = await load(locale);

      expect(messages['PaymentsPanel.statusPending']).toBe(
        catalogue['PaymentsPanel.statusPending']
      );
    }
  );

  // The shell's `mapLocaleToIntlLocale` collapses everything outside de/es/fr/pt-BR onto `en` —
  // including `pt-PT`, which matches pt-BR only on the exact tag.
  it.each(['it', 'pt-PT'])(
    'falls back to the English defaults for unsupported locale %s',
    async (locale) => {
      const messages = await load(locale);

      Object.entries(coreCatalogue).forEach(([id, defaultText]) => {
        expect(messages[id]).toBe(defaultText);
      });
    }
  );

  it.each(['en', 'en-GB', 'de', 'fr-FR', 'pt-BR'])(
    'plugs the appkit catalogue gap for locale %s',
    async (locale) => {
      const messages = await load(locale);

      Object.entries(appkitGapCatalogue).forEach(([id, defaultText]) => {
        expect(messages[id]).toBe(defaultText);
      });
    }
  );
});

describe('appkit-en-gap.json drift guard', () => {
  it('matches the defaultMessages declared by the installed application-shell exactly', () => {
    const distDir = path.join(
      path.dirname(
        require.resolve(
          '@commercetools-frontend/application-shell/package.json'
        )
      ),
      'dist'
    );
    const chunk = fs
      .readdirSync(distDir)
      .find(
        (file) =>
          file.startsWith('user-settings-menu-') && file.endsWith('.cjs.dev.js')
      );
    expect(chunk).toBeDefined();

    const source = fs.readFileSync(path.join(distDir, chunk as string), 'utf8');
    const messagePattern =
      /id:\s*'(UserSettingsMenu\.[A-Za-z]+)',\s*(?:description:\s*'[^']*',\s*)?defaultMessage:\s*'([^']*)'/g;
    const declared: Record<string, string> = {};
    let match;
    while ((match = messagePattern.exec(source)) !== null) {
      const [, id, defaultMessage] = match;
      declared[id] = defaultMessage;
    }

    expect(declared).toEqual(appkitGapCatalogue);
  });
});
