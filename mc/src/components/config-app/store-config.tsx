/**
 * Loads the selected store's config and hands it to `StoreConfigBody` as the Formik seed. Keyed by store
 * key at the parent, so switching stores remounts this with that store's data. The payment-methods
 * catalogue is NOT read here - it is environment-scoped, and the body owns the selected environment.
 */

import { useIntl } from 'react-intl';
import { Formik } from 'formik';
import { ContentNotification } from '@commercetools-uikit/notifications';
import { useBusy } from '../shared/busy-overlay';
import { useProcessorClient } from '../../processor';
import { useStoreConfig } from '../../hooks/use-store-config';
import {
  ReferenceDataProvider,
  useReferenceData,
} from '../../hooks/use-reference-data';
import { configToForm } from './config-model';
import StoreConfigBody from './store-config-body';
import messages from './messages';

const StoreConfig = ({ storeKey }: { storeKey: string }) => {
  const intl = useIntl();
  const client = useProcessorClient(storeKey);
  const referenceData = useReferenceData(storeKey);
  const { config, loading, error } = useStoreConfig(storeKey);
  useBusy(loading);

  if (loading) {
    return null;
  }
  if (error || !config) {
    return (
      <ContentNotification type="error">
        {intl.formatMessage(messages.configLoadError)}
      </ContentNotification>
    );
  }

  return (
    <ReferenceDataProvider value={referenceData}>
      <Formik
        initialValues={configToForm(config)}
        onSubmit={() => undefined}
        enableReinitialize
      >
        <StoreConfigBody
          client={client}
          storeKey={storeKey}
          initialConfig={config}
        />
      </Formik>
    </ReferenceDataProvider>
  );
};
StoreConfig.displayName = 'StoreConfig';

export default StoreConfig;
