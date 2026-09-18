import { createPortal } from 'react-dom';
import { useIsMutating } from '@tanstack/react-query';
import { useIntl } from 'react-intl';
import FlatButton from '@commercetools-uikit/flat-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { ContentNotification } from '@commercetools-uikit/notifications';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import { useOrderId } from '../../hooks/use-order-id';
import { useOrderPayments } from '../../hooks/use-order-payments';
import { formatProcessorError } from './processor-error-message';
import UnzerPaymentCard from './unzer-payment-card';
import messages from './messages';

/**
 * The vendor payment panel of one Merchant Center order: one Unzer-styled card per
 * connector payment. It is fed by exactly one processor read, whose response carries
 * every field on screen — summary book, transaction legs and headrooms alike — so a re-render or
 * a second look costs no request.
 *
 * A read can fail with the panel already on screen: every action re-reads, and that refetch is what
 * states the vendor's answer — so it fires exactly when the operator is reading one. A failed refetch
 * leaves the query in `error` and KEEPS the data it had, which is the only honest state to render: the
 * figures are still the ones the processor last gave, and the refusal in the open dialog is still the
 * vendor's word. Tearing the panel down for the failed refresh would replace an acquirer's decline with
 * a connector outage the operator does not have.
 */

type OrderPanelProps = { orderId: string };

const OrderPanel = ({ orderId }: OrderPanelProps) => {
  const intl = useIntl();
  const { data, loading, refreshing, error, refetch } =
    useOrderPayments(orderId);
  // Any action, on any card, that is still on its way to the vendor. Read from the mutation cache
  // rather than from a card, because the block is the PANEL's: the re-read an action fires refreshes
  // every payment on the order, so no card's figures are safe to act on while one is out.
  const blocked = useIsMutating() > 0 || refreshing;

  if (loading) {
    return (
      <LoadingSpinner scale="s">
        {intl.formatMessage(messages.loading)}
      </LoadingSpinner>
    );
  }

  // Nothing was ever read (no order, no permission, processor down): there is nothing to render but the
  // reason and a way to try again.
  if (error && !data) {
    return (
      <ContentNotification type="error">
        <Spacings.Inline scale="m" alignItems="center">
          <Text.Body>{formatProcessorError(intl, error)}</Text.Body>
          <FlatButton
            label={intl.formatMessage(messages.retry)}
            onClick={refetch}
          />
        </Spacings.Inline>
      </ContentNotification>
    );
  }

  // A settled query that neither errored nor produced data cannot happen; React needs the branch.
  if (!data) {
    return null;
  }

  return (
    <Spacings.Stack scale="xl">
      {error ? (
        <ContentNotification type="warning">
          <Spacings.Inline scale="m" alignItems="center">
            <Text.Body>
              {intl.formatMessage(messages.refreshFailed, {
                reason: formatProcessorError(intl, error),
              })}
            </Text.Body>
            <FlatButton
              label={intl.formatMessage(messages.retry)}
              onClick={refetch}
            />
          </Spacings.Inline>
        </ContentNotification>
      ) : null}

      {data.payments.length === 0 ? (
        <ContentNotification type="info">
          <Text.Body intlMessage={messages.noPayments} />
        </ContentNotification>
      ) : (
        <Spacings.Stack scale="l">
          {data.payments.map((payment) => (
            <UnzerPaymentCard
              key={payment.id}
              orderId={orderId}
              payment={payment}
              // A read running under the rendered panel means these amounts are about to be replaced.
              // Every card goes inert for it, not just the one whose action started it: the re-read
              // refreshes them all, and the headroom on any of them may move.
              busy={refreshing}
              onRefresh={refetch}
            />
          ))}
        </Spacings.Stack>
      )}

      {/* The block is a real one, not a styling of it: nothing is clickable while an operation is out
          and nothing may be decided against figures that are being replaced.

          PORTALLED to the body on purpose. The confirmation dialog is itself a portal rendered there,
          so an overlay living inside this panel's own subtree cannot cover it whatever z-index it
          carries — the dialog would stay live above a panel that only LOOKS frozen. Appended after it
          and at the top of the stack, this covers the dialog too. */}
      {blocked
        ? createPortal(
            <div
              className="unzer-blocking-overlay"
              data-testid="unzer-blocking-overlay"
            >
              <LoadingSpinner scale="l" />
            </div>,
            document.body
          )
        : null}
    </Spacings.Stack>
  );
};
OrderPanel.displayName = 'OrderPanel';

const PaymentsPanel = () => {
  const orderId = useOrderId();

  // The panel is mounted on the order-details page, so a missing id means the host URL is not the one
  // the locator promises — a deployment defect, not an empty state.
  if (!orderId) {
    return (
      <ContentNotification type="error">
        <Text.Body intlMessage={messages.orderIdMissing} />
      </ContentNotification>
    );
  }

  return <OrderPanel orderId={orderId} />;
};
PaymentsPanel.displayName = 'PaymentsPanel';

export default PaymentsPanel;
