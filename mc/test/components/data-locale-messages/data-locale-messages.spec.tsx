import { render, screen } from '@testing-library/react';
import { FormattedMessage, IntlProvider } from 'react-intl';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import DataLocaleMessages from '../../../src/components/data-locale-messages';
import coreCatalogue from '../../../src/i18n/data/core.json';
import deCatalogue from '../../../src/i18n/data/de.json';
import frFRCatalogue from '../../../src/i18n/data/fr-FR.json';

/**
 * The Merchant Center header's locale dropdown switches the DATA locale (`context.dataLocale`) —
 * live React state, no page load — and by platform design does NOT touch the shell's UI language.
 * `DataLocaleMessages` makes this app follow that dropdown anyway: it overlays its own
 * `IntlProvider` (fed by the same `loadMessages` loader) keyed on `dataLocale`, so the app content
 * re-renders in the selected language the moment the operator picks it.
 */

jest.mock('@commercetools-frontend/application-shell-connectors', () => ({
  useApplicationContext: jest.fn(),
}));

const useApplicationContextMock = useApplicationContext as jest.MockedFunction<
  typeof useApplicationContext
>;

const setDataLocale = (dataLocale: string | null) => {
  useApplicationContextMock.mockImplementation((selector) =>
    selector?.({ dataLocale } as never)
  );
};

// Simulates the shell's own IntlProvider (user-profile language: English) sitting above the app.
const renderInShell = (ui: React.ReactElement) =>
  render(ui, {
    wrapper: ({ children }) => (
      <IntlProvider locale="en" messages={coreCatalogue}>
        {children}
      </IntlProvider>
    ),
  });

// A FRESH element per render: `rerender` with a referentially identical element lets React bail
// out of the whole subtree, so the mocked context change would never be observed. In the real app
// the context update itself forces the re-render.
const makeProbe = () => (
  <DataLocaleMessages>
    <FormattedMessage id="ConfigApp.title" defaultMessage="__unresolved__" />
  </DataLocaleMessages>
);

describe('DataLocaleMessages', () => {
  it('renders the app content in the header-selected data locale', async () => {
    setDataLocale('de');
    renderInShell(makeProbe());

    expect(
      await screen.findByText(deCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();
  });

  it('re-renders live when the header data locale changes', async () => {
    setDataLocale('en');
    const view = renderInShell(makeProbe());
    expect(
      await screen.findByText(coreCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();

    setDataLocale('fr-FR');
    view.rerender(makeProbe());

    expect(
      await screen.findByText(frFRCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();
  });

  it('maps a regional data locale onto its language catalogue', async () => {
    setDataLocale('de-AT');
    renderInShell(makeProbe());

    expect(
      await screen.findByText(deCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();
  });

  it('falls back to English for a data locale outside the translated set', async () => {
    setDataLocale('it');
    renderInShell(makeProbe());

    expect(
      await screen.findByText(coreCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();
  });

  it('leaves the shell-provided messages in place while no data locale is set', async () => {
    setDataLocale(null);
    renderInShell(makeProbe());

    expect(
      await screen.findByText(coreCatalogue['ConfigApp.title'])
    ).toBeInTheDocument();
  });
});
