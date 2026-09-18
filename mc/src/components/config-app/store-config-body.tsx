/**
 * One store's configuration: the Connection / Payment-methods tabs, and every section callback wired to
 * the processor. Mounted inside the Formik connection form, whose seed it also re-seeds after each save.
 *
 * `persisted` is the last config the processor returned - the connection gating and the disconnect flow
 * read it, never the live form. The Payment-methods tab CONTENT waits on its own catalogue fetch, so a
 * first connect keeps this body mounted instead of reverting to the disconnected view.
 */

import { useState } from 'react';
import {
  Switch,
  Route,
  Redirect,
  NavLink,
  useHistory,
  useRouteMatch,
} from 'react-router-dom';
import { useIntl } from 'react-intl';
import { Form, useFormikContext } from 'formik';
import { useShowNotification } from '@commercetools-frontend/actions-global';
import {
  DOMAINS,
  NOTIFICATION_KINDS_SIDE,
} from '@commercetools-frontend/constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusy } from '../shared/busy-overlay';
import type { ProcessorClient } from '../../processor';
import { storeConfigQueryKey } from '../../hooks/use-store-config';
import type { StoreConfigDto } from '../../types/config';
import {
  configToForm,
  environmentConnected,
  formToConfig,
  type ConfigFormValues,
  type StoreMode,
} from './config-model';
import { paymentMethodsQueryKey } from './query-keys';
import PaymentMethodsPanel from './payment-methods-panel';
import { ConnectionSection } from './sections/connection';
import { formatProcessorErrorGeneric } from './processor-error-message';
import messages from './messages';

/**
 * The environments whose key pair this save REPLACES - connected already, and a key differs from what is
 * persisted. That is the processor's own trigger for clearing an environment's payment-method config
 *, so the cached method list has to go with it. Both environments are checked: every save
 * submits both blocks.
 */
const rotatedModes = (
  values: ConfigFormValues,
  persisted: StoreConfigDto
): StoreMode[] => {
  const seed = configToForm(persisted);
  return (['sandbox', 'live'] as StoreMode[]).filter(
    (mode) =>
      environmentConnected(persisted.environments?.[mode]) &&
      (values.environments[mode].publicKey !==
        seed.environments[mode].publicKey ||
        values.environments[mode].privateKey !==
          seed.environments[mode].privateKey)
  );
};

const StoreConfigBody = ({
  client,
  storeKey,
  initialConfig,
}: {
  client: ProcessorClient;
  storeKey: string;
  initialConfig: StoreConfigDto;
}) => {
  const intl = useIntl();
  const showNotification = useShowNotification();
  const formik = useFormikContext<ConfigFormValues>();
  const queryClient = useQueryClient();
  const history = useHistory();
  const { url } = useRouteMatch();
  const base = url.endsWith('/') ? url.slice(0, -1) : url;
  const connectionPath = `${base}/connection`;
  const methodsPath = `${base}/payment-methods`;

  const [persisted, setPersisted] = useState(initialConfig);

  const formMode = formik.values.mode;
  const connectedActive = environmentConnected(
    persisted.environments?.[formMode]
  );

  const methodsQuery = useQuery({
    queryKey: paymentMethodsQueryKey(storeKey, formMode),
    queryFn: () => client.getPaymentMethods(formMode),
    enabled: connectedActive,
  });
  const methodsPending = connectedActive && methodsQuery.isPending;
  useBusy(methodsPending);
  const initialMethods = methodsQuery.data?.paymentMethods ?? [];

  /** Persists the form and returns the SERVER's config - the only authority on what is now stored. */
  const persist = async (): Promise<StoreConfigDto> => {
    const dto = formToConfig(formik.values);
    const response = await client.putStoreConfig(dto);
    queryClient.setQueryData(storeConfigQueryKey(storeKey), response);
    setPersisted(response);
    await formik.setValues(configToForm(response));
    return response;
  };

  /** Both outcomes of an action are reported on the same channel, so the operator looks in one place. */
  const notifyFailure = (
    error: unknown,
    generic: typeof messages.saveError
  ) => {
    showNotification({
      domain: DOMAINS.SIDE,
      kind: NOTIFICATION_KINDS_SIDE.error,
      text: formatProcessorErrorGeneric(
        intl,
        error,
        intl.formatMessage(generic)
      ),
    });
  };

  const handleSave = async (): Promise<boolean> => {
    // Read BEFORE the save: `persist` re-seeds the form, after which there is nothing left to compare.
    const rotated = rotatedModes(formik.values, persisted);
    try {
      const saved = await persist();
      // A rotation made the processor delete that environment's method config, and this app caches for
      // the whole session - dropping the entry is what refreshes the tab instead of showing stale config.
      //
      // A CONNECTION SAVE drops BOTH environments' entries regardless: until the store had a connection
      // object of its own it INHERITED the DEFAULT scope's methods, and the save is what ends
      // that inheritance - for both environments at once, since inheritance keys off the object existing
      // and not off a mode. A cached list from before the save is the default scope's, so the tab showed
      // another account's enabled methods until a full page reload.
      for (const mode of new Set<StoreMode>([...rotated, 'sandbox', 'live'])) {
        queryClient.removeQueries({
          queryKey: paymentMethodsQueryKey(storeKey, mode),
        });
      }
      showNotification({
        domain: DOMAINS.SIDE,
        kind: NOTIFICATION_KINDS_SIDE.success,
        text: intl.formatMessage(messages.saveSuccess),
      });
      // A FIRST connect opens the tab the operator's next step is on. Decided from the PUT RESPONSE, not
      // from `connectedActive`, which reads state React has not re-rendered yet.
      if (
        !connectedActive &&
        environmentConnected(saved.environments?.[formMode])
      ) {
        history.push(methodsPath);
      }
      return true;
    } catch (error) {
      notifyFailure(error, messages.saveError);
      return false;
    }
  };

  const handleDisconnect = async (): Promise<boolean> => {
    try {
      await client.deleteConnection(formMode);
      // The disconnect DELETES that environment's method config on the processor, so its
      // cached list goes too - otherwise a re-connect would show, and re-persist, what no longer exists.
      queryClient.removeQueries({
        queryKey: paymentMethodsQueryKey(storeKey, formMode),
      });
      const config = await queryClient.fetchQuery({
        queryKey: storeConfigQueryKey(storeKey),
        queryFn: () => client.getStoreConfig(),
        staleTime: 0,
      });
      setPersisted(config);
      await formik.setValues(configToForm(config));
      showNotification({
        domain: DOMAINS.SIDE,
        kind: NOTIFICATION_KINDS_SIDE.success,
        text: intl.formatMessage(messages.disconnectSuccess),
      });
      return true;
    } catch (error) {
      notifyFailure(error, messages.disconnectError);
      return false;
    }
  };

  return (
    <Form>
      <nav className="unzer-tabs">
        <NavLink
          exact
          to={connectionPath}
          className="unzer-tab"
          activeClassName="unzer-tab--active"
        >
          {intl.formatMessage(messages.tabConnection)}
        </NavLink>
        {connectedActive ? (
          <NavLink
            to={methodsPath}
            className="unzer-tab"
            activeClassName="unzer-tab--active"
          >
            {intl.formatMessage(messages.tabPaymentMethods)}
          </NavLink>
        ) : null}
      </nav>

      <div className="unzer-content">
        <Switch>
          <Route path={connectionPath}>
            <ConnectionSection
              connected={connectedActive}
              onSave={handleSave}
              onDisconnect={handleDisconnect}
            />
          </Route>
          <Route path={methodsPath}>
            {!connectedActive ? (
              <Redirect to={connectionPath} />
            ) : methodsPending ? null : (
              <PaymentMethodsPanel
                // Remount on the STORE as well as the environment: the panel seeds its editable list from
                // `initialMethods` ONCE (`useState`), so a key that names only the environment leaves the
                // previous store's toggles standing over the newly fetched catalogue.
                key={`${storeKey}:${formMode}`}
                client={client}
                storeKey={storeKey}
                mode={formMode}
                initialMethods={initialMethods}
              />
            )}
          </Route>
          <Redirect to={connectionPath} />
        </Switch>
      </div>
    </Form>
  );
};
StoreConfigBody.displayName = 'StoreConfigBody';

export default StoreConfigBody;
