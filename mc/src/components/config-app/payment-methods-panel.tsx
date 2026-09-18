/**
 * The Payment-methods tab content: the editable method list plus its settings modal, persisted through
 * the processor. There is no tab-level save - the modal's `Save changes` persists, and so does switching
 * a method OFF; switching one ON is staged so the enable and the settings land in one write.
 */

import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import { useShowNotification } from '@commercetools-frontend/actions-global';
import {
  DOMAINS,
  NOTIFICATION_KINDS_SIDE,
} from '@commercetools-frontend/constants';
import { useQueryClient } from '@tanstack/react-query';
import type { ProcessorClient } from '../../processor';
import type { UnzerMethodConfigDto } from '../../types/config';
import type { StoreMode } from './config-model';
import { paymentMethodsQueryKey } from './query-keys';
import {
  MethodSettingsModal,
  PaymentMethodsSection,
} from './sections/payment-methods';
import { formatProcessorError } from './processor-error-message';
import messages from './messages';

/** The members the GET view derives and the strict PUT rejects: read for display, never persisted. */
const derivedOf = (method: UnzerMethodConfigDto) => ({
  supportsAuthorize: method.supportsAuthorize,
  supportsCharge: method.supportsCharge,
  logo: method.logo,
  vendorCardNetworks: method.vendorCardNetworks,
  vendorCountries: method.vendorCountries,
  vendorCurrencies: method.vendorCurrencies,
  vendorCustomerTypes: method.vendorCustomerTypes,
  vendorChannel: method.vendorChannel,
});

/** The same method without any derived member - the shape the PUT request schema accepts. */
const stripDerived = ({
  supportsAuthorize: _supportsAuthorize,
  supportsCharge: _supportsCharge,
  logo: _logo,
  vendorCardNetworks: _vendorCardNetworks,
  vendorCountries: _vendorCountries,
  vendorCurrencies: _vendorCurrencies,
  vendorCustomerTypes: _vendorCustomerTypes,
  vendorChannel: _vendorChannel,
  ...persisted
}: UnzerMethodConfigDto) => persisted;

const PaymentMethodsPanel = ({
  client,
  storeKey,
  mode,
  initialMethods,
}: {
  client: ProcessorClient;
  storeKey: string;
  mode: StoreMode;
  /** The settled catalogue - the parent renders this only once the fetch resolved. */
  initialMethods: UnzerMethodConfigDto[];
}) => {
  const intl = useIntl();
  const showNotification = useShowNotification();
  const queryClient = useQueryClient();

  const [methods, setMethods] = useState(initialMethods);
  const [editingMethod, setEditingMethod] =
    useState<UnzerMethodConfigDto | null>(null);
  /** The method whose enable this modal carries, so Cancel can put the toggle back. */
  const [stagedEnableCode, setStagedEnableCode] = useState<string | null>(null);

  /**
   * Persist the list and adopt what came back. Every derived member - the two capability flags, the logo and
   * the vendor's own coverage - is read-only, so all of them are stripped before the strict PUT and re-merged
   * from local state afterwards: the PUT echo is the request shape and carries none of them. Rethrows after
   * the error toast, so the modal can stay open on failure.
   */
  const persistMethods = async (
    next: UnzerMethodConfigDto[]
  ): Promise<void> => {
    try {
      const payload = next.map((method) => stripDerived(method));
      const response = await client.putPaymentMethods(
        { paymentMethods: payload },
        mode
      );
      const derivedByCode = new Map(
        next.map((method) => [method.paymentMethodCode, derivedOf(method)])
      );
      const merged = response.paymentMethods.map((method) => ({
        ...method,
        ...derivedByCode.get(method.paymentMethodCode),
      }));
      queryClient.setQueryData(paymentMethodsQueryKey(storeKey, mode), {
        paymentMethods: merged,
      });
      setMethods(merged);
      showNotification({
        domain: DOMAINS.SIDE,
        kind: NOTIFICATION_KINDS_SIDE.success,
        text: intl.formatMessage(messages.methodsSaveSuccess),
      });
    } catch (error) {
      showNotification({
        domain: DOMAINS.SIDE,
        kind: NOTIFICATION_KINDS_SIDE.error,
        text: formatProcessorError(
          intl,
          error,
          intl.formatMessage(messages.methodsSaveError)
        ),
      });
      throw error;
    }
  };

  /** The modal saved: merge the edited method into the list and persist it, then close. */
  const applyMethod = async (next: UnzerMethodConfigDto): Promise<void> => {
    const merged = methods.map((method) =>
      method.paymentMethodCode === next.paymentMethodCode ? next : method
    );
    setMethods(merged);
    await persistMethods(merged);
    setStagedEnableCode(null);
    setEditingMethod(null);
  };

  /** The modal was dismissed: drop an enable it was carrying, since nothing reached the processor. */
  const cancelEdit = (): void => {
    if (stagedEnableCode) {
      setMethods((current) =>
        current.map((method) =>
          method.paymentMethodCode === stagedEnableCode
            ? { ...method, enabled: false }
            : method
        )
      );
    }
    setStagedEnableCode(null);
    setEditingMethod(null);
  };

  return (
    <Fragment>
      <PaymentMethodsSection
        methods={methods}
        onMethodsChange={setMethods}
        onPersist={persistMethods}
        onOpenSettings={(method, staged) => {
          setStagedEnableCode(staged ? method.paymentMethodCode : null);
          setEditingMethod(method);
        }}
      />
      {editingMethod ? (
        <MethodSettingsModal
          key={editingMethod.paymentMethodCode}
          method={editingMethod}
          isOpen
          onClose={cancelEdit}
          onSave={applyMethod}
        />
      ) : null}
    </Fragment>
  );
};
PaymentMethodsPanel.displayName = 'PaymentMethodsPanel';

export default PaymentMethodsPanel;
