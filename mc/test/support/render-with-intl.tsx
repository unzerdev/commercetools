/**
 * A minimal render helper for the shared-component unit tests. The CT primitives these components wrap
 * (text/password fields, select, localized input) call `useIntl`, so they need an `IntlProvider` in the
 * tree; the full MC application-shell render is unnecessary here and far heavier. Screen-level tests use
 * `renderAppWithRedux` from `./render-app` instead.
 */

import type { ReactElement } from 'react';
import { IntlProvider } from 'react-intl';
import { render, type RenderOptions } from '@testing-library/react';

/**
 * `locale` drives what the component under test reads from `intl.locale` (per-language links, formats).
 * It is also the `defaultLocale`, so the inline `defaultMessage`s count as that language's translations
 * and react-intl logs no MISSING_TRANSLATION - which the preset turns into a failure.
 */
export const renderWithIntl = (
  ui: ReactElement,
  {
    locale = 'en',
    ...options
  }: Omit<RenderOptions, 'wrapper'> & { locale?: string } = {}
) =>
  render(ui, {
    wrapper: ({ children }) => (
      <IntlProvider locale={locale} defaultLocale={locale} messages={{}}>
        {children}
      </IntlProvider>
    ),
    ...options,
  });
