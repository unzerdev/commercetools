/**
 * The Unzer configuration screen: a full-bleed magenta banner (wordmark + store selector) over the
 * selected store's configuration. The store list is the processor's own (`/operations/stores`), and the
 * selected key drives the processor client - it rides every call as the `X-Store-Key` forward header.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useIsFetching } from '@tanstack/react-query';
import BusyOverlayHost, { useBusy } from '../shared/busy-overlay';
import UnzerLogo from '../branding/unzer-logo';
import { useStores } from '../../hooks/use-stores';
import StoreConfig from './store-config';
import messages from './messages';

const ConfigApp = () => {
  const intl = useIntl();
  const { stores, loading: storesLoading, error: storesError } = useStores();
  const [selectedStoreKey, setSelectedStoreKey] = useState<string>();

  const storeOptions = useMemo(
    () =>
      stores.map((store) => ({
        value: store.key,
        label: store.isDefault
          ? intl.formatMessage(messages.defaultScopeLabel)
          : store.name,
      })),
    [stores, intl]
  );

  // Open on the first entry - the default scope - once the list resolves; never override a later choice.
  useEffect(() => {
    if (!selectedStoreKey && storeOptions.length > 0) {
      setSelectedStoreKey(storeOptions[0].value);
    }
  }, [selectedStoreKey, storeOptions]);

  const configFetching =
    useIsFetching({ queryKey: ['processor', 'store-config'] }) > 0;
  useBusy(storesLoading || configFetching);

  const hasStores = storeOptions.length > 0;
  const storeNotice: ReactNode = (() => {
    if (storesError) {
      return (
        <ContentNotification type="error">
          {intl.formatMessage(messages.storesError)}
        </ContentNotification>
      );
    }
    if (storesLoading) {
      return null;
    }
    if (!hasStores) {
      return (
        <ContentNotification type="warning">
          {intl.formatMessage(messages.storesEmpty)}
        </ContentNotification>
      );
    }
    return null;
  })();

  return (
    <div className="unzer-app">
      <h1 className="unzer-visually-hidden">
        {intl.formatMessage(messages.title)}
      </h1>
      <div className="unzer-banner">
        <div className="unzer-banner__left">
          <UnzerLogo height={22} />
          {hasStores ? (
            <Fragment>
              <span className="unzer-banner__divider" />
              <select
                className="unzer-banner__select"
                aria-label={intl.formatMessage(messages.storeSelectorLabel)}
                value={selectedStoreKey ?? ''}
                disabled={configFetching}
                onChange={(event) => setSelectedStoreKey(event.target.value)}
              >
                {storeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Fragment>
          ) : null}
        </div>
      </div>
      <BusyOverlayHost />
      {storeNotice ? <div className="unzer-content">{storeNotice}</div> : null}
      {selectedStoreKey ? (
        <StoreConfig key={selectedStoreKey} storeKey={selectedStoreKey} />
      ) : null}
    </div>
  );
};
ConfigApp.displayName = 'ConfigApp';

export default ConfigApp;
