import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { IntlProvider } from 'react-intl';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { AsyncLocaleData } from '@commercetools-frontend/i18n';
import loadMessages from '../../load-messages';

type TDataLocaleMessagesProps = {
  children: ReactNode;
};

// The Merchant Center header's locale dropdown switches the DATA locale (`context.dataLocale`) —
// live React state, no page load — and by platform design does NOT touch the shell's UI language
// (that follows the operator's profile language). This view follows the dropdown anyway: an
// `IntlProvider` overlaid on the shell's, fed by the same `loadMessages` loader keyed on
// `dataLocale`, re-renders the view content in the selected language the moment the operator picks
// it. `AsyncLocaleData` also reloads the ui-kit/appkit catalogues and moment data for that locale,
// so embedded uikit widgets and date/number formats follow along. Until the first catalogue load
// resolves (or when no data locale is set yet), the shell-provided messages stay in effect.
const DataLocaleMessages = (props: TDataLocaleMessagesProps) => {
  const dataLocale = useApplicationContext((context) => context.dataLocale);
  if (!dataLocale) {
    return <Fragment>{props.children}</Fragment>;
  }
  return (
    <AsyncLocaleData locale={dataLocale} applicationMessages={loadMessages}>
      {({ locale, messages }) =>
        locale && messages ? (
          <IntlProvider locale={locale} messages={messages}>
            {props.children}
          </IntlProvider>
        ) : (
          <Fragment>{props.children}</Fragment>
        )
      }
    </AsyncLocaleData>
  );
};
DataLocaleMessages.displayName = 'DataLocaleMessages';

export default DataLocaleMessages;
