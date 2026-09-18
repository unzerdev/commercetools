import { Fragment, type CSSProperties, useEffect, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useIntl, type IntlShape, type MessageDescriptor } from 'react-intl';
import { ConfirmationDialog } from '@commercetools-frontend/application-components';
import { NO_VALUE_FALLBACK } from '@commercetools-frontend/constants';
import Card from '@commercetools-uikit/card';
import DataTable, {
  type TColumn,
  type TRow,
} from '@commercetools-uikit/data-table';
import FlatButton from '@commercetools-uikit/flat-button';
import { ContentNotification } from '@commercetools-uikit/notifications';
import Spacings from '@commercetools-uikit/spacings';
import Stamp from '@commercetools-uikit/stamp';
import Text from '@commercetools-uikit/text';
import { usePaymentIntent } from '../../hooks/use-order-payments';
import {
  isConcurrentModification,
  useExternalApiUrl,
} from '../../hooks/use-processor-client';
import {
  hasPaymentDetails,
  type MoneyDto,
  type OrderPaymentDto,
  type PaymentDetailsDto,
  type PaymentIntentActionDto,
} from '../../types/payments';
import MethodCell from './method-display';
import { formatMoney, hasHeadroom, toMajorUnit, toMoney } from './money';
import { formatProcessorError } from './processor-error-message';
import UnzerLogo from './unzer-logo';
import messages from './messages';

/**
 * ONE connector payment as one Unzer-styled card: header with the payment's identity,
 * summary row and transaction table from the provider's own read, and the three inline
 * actions. The whole card derives from the one panel read it was handed - it fetches
 * nothing on its own.
 *
 * The two data sources never mix: what the card DISPLAYS (amount book, legs) is the vendor's word
 * via `details`; the method name and what an action is ALLOWED to do are commercetools' word —
 * which is why the actions keep working while the vendor is unreachable, and why an
 * unavailable `details` degrades only the summary and history area.
 *
 * An ANSWERED action never patches the card — an approval, an acceptance and a refusal alike: it
 * invalidates the order's cache entry (see `usePaymentIntent`) and the panel re-reads. A refusal
 * reaches the operator through `intent.error` like any other failure, because the mutation raises
 * it as one: the vendor declines in a 200 body, and a dialog that closed on it would show a refusal
 * exactly as it shows an approval. A LOST VERSION RACE (409) is the one rejection that is not a
 * fault: the payment moved and nothing reached the vendor — it is answered by re-reading the panel,
 * never by retrying a decision taken against money that is no longer there.
 */

/**
 * All three actions carry an amount input. A cancel used to void the capture headroom whole; it can now
 * void PART of it and leave the rest capturable, so it is offered on the same terms as the other two —
 * seeded with its full headroom, which is what confirming it unchanged still does.
 */
type ActionKind = 'capture' | 'refund' | 'cancel';

/** Why a typed figure cannot be submitted — one refusal message each. */
type AmountError = 'invalidFormat' | 'notPositive' | 'aboveMaximum';

const actionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};
const amountBoxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: 200,
};

/**
 * The operator types and reads major units, with `.` or `,` as the decimal separator and at most the
 * currency's own minor digits. Anything else is REFUSED, never coerced: `Number` reads `0x10` as 16 and
 * `1e3` as 1000, and a string `replace` swaps only the first comma, so a thousands-separated `1,234`
 * would submit 1.234 — a figure the operator never typed, with nothing on screen saying it changed.
 * `undefined` is "unparseable", which the amount row reports as a refusal rather than a submittable
 * amount.
 */
const AMOUNT_GRAMMAR = /^\d+(?:[.,](\d+))?$/;

const parseAmount = (
  raw: string,
  fractionDigits: number
): number | undefined => {
  const trimmed = raw.trim();
  const match = AMOUNT_GRAMMAR.exec(trimmed);
  if (match === null) return undefined;
  if ((match[1] ?? '').length > fractionDigits) return undefined;
  return Number(trimmed.replace(',', '.'));
};

/** The accessible name of each amount input names the action it feeds, not a shared "Amount". */
const amountLabelMessages: Record<ActionKind, MessageDescriptor> = {
  capture: messages.captureAmountLabel,
  refund: messages.refundAmountLabel,
  cancel: messages.cancelAmountLabel,
};

/** The display labels of the leg kinds the connector names; an unknown kind renders verbatim. */
const legTypeMessages = {
  authorization: messages.legTypeAuthorization,
  charge: messages.legTypeCharge,
  refund: messages.legTypeRefund,
  reversal: messages.legTypeReversal,
} as const;

const legTypeLabel = (intl: IntlShape, type: string): string =>
  type in legTypeMessages
    ? intl.formatMessage(legTypeMessages[type as keyof typeof legTypeMessages])
    : type;

/**
 * The summary's Date is the payment's FIRST leg — the vendor promises no ordering for the list, so
 * it is derived, not read off index 0. ISO-8601 compares chronologically as a string; `Date.parse`
 * is still preferred so a vendor timestamp with an offset keeps ordering correctly.
 */
const earliestOperationDate = (
  operations: PaymentDetailsDto['operations']
): string | undefined =>
  operations
    .map((operation) => operation.date)
    .filter((date): date is string => date !== undefined)
    .reduce<string | undefined>((earliest, date) => {
      if (earliest === undefined) return date;
      const a = Date.parse(earliest);
      const b = Date.parse(date);
      if (Number.isNaN(a) || Number.isNaN(b))
        return date < earliest ? date : earliest;
      return b < a ? date : earliest;
    }, undefined);

const outcomeMessages = {
  success: messages.statusSuccess,
  pending: messages.statusPending,
  error: messages.statusError,
} as const;

/**
 * The vendor's own payment states, as Unzer documents them. `rawStatus` is a verbatim vendor lift, so
 * a state this release has no words for renders as the vendor wrote it rather than as a blank.
 */
const stateMessages = {
  create: messages.state_create,
  pending: messages.state_pending,
  completed: messages.state_completed,
  partly: messages.state_partly,
  canceled: messages.state_canceled,
  payment_review: messages.state_payment_review,
  chargeback: messages.state_chargeback,
} as const;

const stateLabel = (intl: IntlShape, rawStatus: string): string =>
  rawStatus in stateMessages
    ? intl.formatMessage(stateMessages[rawStatus as keyof typeof stateMessages])
    : rawStatus;

/**
 * One history line. The leg is kept in its own field rather than spread: DataTable needs a row `id`,
 * and a leg carries an `id` of its own — the vendor's transaction id, which the table has a column
 * for. Spreading would silently overwrite one with the other.
 */
type HistoryRow = {
  id: string;
  operation: PaymentDetailsDto['operations'][number];
};

export type UnzerPaymentCardProps = {
  orderId: string;
  payment: OrderPaymentDto;
  /**
   * A read is in flight under the rendered panel, so the amounts and headroom on screen are already
   * stale. The card goes inert for it: an action decided against figures that are being replaced is an
   * action decided against money that may no longer be there.
   */
  busy?: boolean;
  /** Re-runs the panel read, so the operator decides on the amounts the payment holds NOW. */
  onRefresh: () => void;
};

const UnzerPaymentCard = ({
  orderId,
  payment,
  busy = false,
  onRefresh,
}: UnzerPaymentCardProps) => {
  const intl = useIntl();
  const intent = usePaymentIntent(orderId);
  const externalApiUrl = useExternalApiUrl();
  // Nothing may be STARTED while an operation is on its way to the vendor, or while the read that
  // states its outcome is still running. Both windows end with the amounts on screen changing, and a
  // second action taken inside either one is taken against figures that are already wrong.
  //
  // Read from the mutation cache, not from THIS card's own `intent`: each card holds its own mutation,
  // so an action started on one left every other card's controls live. The re-read it fires refreshes
  // the whole order, so no card's headroom survives it untouched. The panel overlay blocks the pointer;
  // this is what makes the controls themselves inert.
  const locked = useIsMutating() > 0 || busy;
  // The open confirmation and the amount SNAPSHOTTED at open. A background refetch re-seeds the
  // inputs under a standing dialog; the dialog names and submits the snapshot, never a live read —
  // or the confirmed figure and the posted figure could swap between open and confirm.
  const [dialog, setDialog] = useState<{
    kind: ActionKind;
    amount: MoneyDto;
  }>();

  const currency = payment.amountPlanned.currencyCode;
  // The scale of every amount on this card, stated by the panel read for this payment.
  const { fractionDigits } = payment;
  const money = (value: MoneyDto) => formatMoney(intl, value, fractionDigits);

  // One amount input per money-carrying action, seeded with its full headroom. The seed is the
  // MAJOR-unit string, so the effect re-seeds exactly when the headroom value changes (after an
  // action's refetch) and never clobbers the operator's typing on an unrelated re-render.
  const captureSeed = String(
    toMajorUnit(payment.capturableAmount, fractionDigits)
  );
  const refundSeed = String(
    toMajorUnit(payment.refundableAmount, fractionDigits)
  );
  const [amounts, setAmounts] = useState<Record<ActionKind, string>>({
    capture: captureSeed,
    refund: refundSeed,
    // A cancel draws on the same headroom a capture does — what is still uncaptured.
    cancel: captureSeed,
  });
  useEffect(() => {
    setAmounts({
      capture: captureSeed,
      refund: refundSeed,
      cancel: captureSeed,
    });
  }, [captureSeed, refundSeed]);

  // Capture and cancel both act on what is still uncaptured; a refund on what was captured. The
  // same rule the processor enforces with a 400, applied early so the operator sees the ceiling
  // instead of a rejection.
  const headroomOf: Record<ActionKind, MoneyDto> = {
    capture: payment.capturableAmount,
    refund: payment.refundableAmount,
    cancel: payment.capturableAmount,
  };
  // Which of the three the payment can actually take. Cancel voids what is still uncaptured, so it
  // shares the capture headroom.
  const canCapture = hasHeadroom(headroomOf.capture);
  const canRefund = hasHeadroom(headroomOf.refund);
  const canCancel = hasHeadroom(payment.capturableAmount);

  const requestedOf = (kind: ActionKind): MoneyDto | undefined => {
    const major = parseAmount(amounts[kind], fractionDigits);
    return major === undefined
      ? undefined
      : toMoney(major, currency, fractionDigits);
  };
  const amountError = (kind: ActionKind): AmountError | undefined => {
    const requested = requestedOf(kind);
    if (requested === undefined) return 'invalidFormat';
    if (requested.centAmount <= 0) return 'notPositive';
    if (requested.centAmount > headroomOf[kind].centAmount)
      return 'aboveMaximum';
    return undefined;
  };

  // The example is rendered in the operator's own number format, which is the format the input accepts.
  const amountExample = intl.formatNumber(10, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  /** The refusal a row states — one message per way the typed figure cannot be submitted. */
  const amountErrorText = (kind: ActionKind, error: AmountError): string => {
    if (error === 'aboveMaximum')
      return intl.formatMessage(messages.amountAboveMaximum, {
        amount: money(headroomOf[kind]),
      });
    if (error === 'notPositive')
      return intl.formatMessage(messages.amountNotPositive);
    return intl.formatMessage(messages.amountFormatInvalid, {
      digits: fractionDigits,
      example: amountExample,
    });
  };

  const open = (kind: ActionKind) => {
    // A failed attempt must not haunt the next dialog the operator opens.
    intent.reset();
    // Every row carries the operator's figure now, a cancel included.
    const amount = requestedOf(kind);
    // The button is disabled while the figure is unparseable, so this is unreachable from the UI — and
    // a confirmation that cannot name an amount is one the operator cannot judge.
    if (amount === undefined) return;
    setDialog({ kind, amount });
  };
  const close = () => setDialog(undefined);
  /** The dismiss the dialog offers while an operation is on its way: none. */
  const closeUnlessInFlight = () => {
    if (!intent.isPending) {
      close();
    }
  };

  // Belt for a dialog left standing across a refetch: a snapshot the fresh headroom no longer
  // covers (or an emptied one) must not reach the processor from a confirm that was armed earlier.
  const snapshotInvalid = ({ kind, amount }: NonNullable<typeof dialog>) =>
    amount.centAmount <= 0 || amount.centAmount > headroomOf[kind].centAmount;

  /** The one action this intent carries; the dialog closes only once the processor accepted it. */
  const submit = (action: PaymentIntentActionDto) =>
    intent.mutate({ paymentId: payment.id, action }, { onSuccess: close });

  // The dialog holds the headroom of the read that just went stale, so the re-read dismisses it:
  // the operator re-opens the action on the amounts the fresh panel shows.
  const refresh = () => {
    close();
    onRefresh();
  };

  // The method is commercetools' word alone — the provider read carries no product naming — so the
  // cell survives a vendor outage with the rest of the CT-sourced fields. Its logo comes from the
  // processor's public asset route, which ships one for every method the connector supports.
  const methodCell = (
    <MethodCell code={payment.paymentMethod} externalApiUrl={externalApiUrl} />
  );

  // A vendor date the browser cannot parse falls back exactly as an absent one does: `intl.formatDate`
  // renders the literal `Invalid Date` for it and raises a react-intl error on every render.
  const dateCell = (date?: string): string =>
    date !== undefined && !Number.isNaN(Date.parse(date))
      ? intl.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' })
      : NO_VALUE_FALLBACK;
  const amountCell = (value?: MoneyDto): string =>
    value ? money(value) : NO_VALUE_FALLBACK;

  /**
   * The summary is the Unzer payment as `GET /v1/payments` reports it: its state, the amount book and
   * the references that read the vendor's resource. The commercetools-sourced fields that used to sit
   * beside them are gone, except the two that name what the vendor answered ABOUT — the payment id the
   * connector reads back from `interfaceId`, and the method, which the vendor's payment read does not
   * carry at all.
   *
   * It reads ACROSS, as two tables of a single row: what the payment IS, and what it is WORTH. Field
   * names are the column headers, which is what a table is for — a two-column "Field / Value" list
   * spends a whole column restating that. The amounts are split off because they are one comparable
   * set: five figures in one currency, read left to right against each other.
   */
  const summaryRow: TRow[] = [{ id: payment.id }];

  const identityColumns = (available: PaymentDetailsDto): TColumn<TRow>[] => [
    {
      key: 'date',
      label: intl.formatMessage(messages.summaryDate),
      renderItem: () => dateCell(earliestOperationDate(available.operations)),
    },
    {
      key: 'paymentId',
      label: intl.formatMessage(messages.summaryPaymentId),
      renderItem: () => payment.providerPaymentId ?? NO_VALUE_FALLBACK,
    },
    {
      key: 'orderId',
      label: intl.formatMessage(messages.summaryOrderId),
      renderItem: () => available.orderId ?? NO_VALUE_FALLBACK,
    },
    {
      key: 'method',
      label: intl.formatMessage(messages.summaryMethod),
      renderItem: () => methodCell,
    },
    {
      key: 'state',
      label: intl.formatMessage(messages.summaryState),
      renderItem: () => stateLabel(intl, available.rawStatus),
    },
    {
      key: 'currency',
      label: intl.formatMessage(messages.summaryCurrency),
      renderItem: () => currency,
    },
  ];

  const amountColumns = (available: PaymentDetailsDto): TColumn<TRow>[] =>
    (
      [
        ['total', messages.summaryTotal, available.amounts?.total],
        [
          'authorized',
          messages.summaryAuthorized,
          available.amounts?.authorized,
        ],
        ['charged', messages.summaryCharged, available.amounts?.charged],
        ['cancelled', messages.summaryCancelled, available.amounts?.cancelled],
        ['refunded', messages.summaryRefunded, available.amounts?.refunded],
      ] as const
    ).map(([key, label, value]) => ({
      key,
      label: intl.formatMessage(label),
      align: 'right' as const,
      renderItem: () => amountCell(value),
    }));

  const summary = (available: PaymentDetailsDto) => (
    <div data-testid="unzer-summary">
      <Spacings.Stack scale="m">
        <div data-testid="unzer-summary-identity">
          <DataTable rows={summaryRow} columns={identityColumns(available)} />
        </div>
        <div data-testid="unzer-summary-amounts">
          <DataTable rows={summaryRow} columns={amountColumns(available)} />
        </div>
      </Spacings.Stack>
    </div>
  );

  /**
   * The vendor's own operation legs. Positional ids on purpose: Unzer cancel ids are parent-scoped, so
   * two legs can share the trailing url segment — and the list is rebuilt wholesale on every read.
   */
  const historyRows = (available: PaymentDetailsDto): HistoryRow[] =>
    available.operations.map((operation, index) => ({
      id: `${payment.id}-leg-${index}`,
      operation,
    }));

  const historyColumns: TColumn<HistoryRow>[] = [
    {
      key: 'date',
      label: intl.formatMessage(messages.tableDate),
      renderItem: (row) => dateCell(row.operation.date),
    },
    {
      key: 'paymentId',
      label: intl.formatMessage(messages.tablePaymentId),
      renderItem: () => payment.providerPaymentId ?? NO_VALUE_FALLBACK,
    },
    {
      key: 'transactionId',
      label: intl.formatMessage(messages.tableTransactionId),
      renderItem: (row) => row.operation.id ?? NO_VALUE_FALLBACK,
    },
    {
      key: 'method',
      label: intl.formatMessage(messages.tableMethod),
      renderItem: () => methodCell,
    },
    {
      key: 'type',
      label: intl.formatMessage(messages.tableType),
      renderItem: (row) =>
        row.operation.type
          ? legTypeLabel(intl, row.operation.type)
          : NO_VALUE_FALLBACK,
    },
    {
      key: 'status',
      label: intl.formatMessage(messages.tableStatus),
      // The wire union guarded, like the leg kinds: an outcome the panel has no words (or pill class)
      // for degrades to an empty cell, never a formatMessage crash.
      renderItem: (row) =>
        row.operation.outcome && row.operation.outcome in outcomeMessages ? (
          <span
            className={`unzer-status unzer-status--${row.operation.outcome}`}
          >
            {intl.formatMessage(outcomeMessages[row.operation.outcome])}
          </span>
        ) : null,
    },
    {
      key: 'amount',
      label: intl.formatMessage(messages.tableAmount),
      align: 'right',
      renderItem: (row) => amountCell(row.operation.amount),
    },
  ];

  // The heading stands whether or not there are legs: it names the section, and a payment with nothing
  // recorded yet still has to say WHAT it has nothing of.
  const history = (available: PaymentDetailsDto) => (
    <Spacings.Stack scale="s">
      <Text.Subheadline as="h5">
        {intl.formatMessage(messages.transactionsTitle)}
      </Text.Subheadline>
      {available.operations.length === 0 ? (
        <Text.Detail tone="secondary" intlMessage={messages.noTransactions} />
      ) : (
        <div data-testid="unzer-history">
          <DataTable<HistoryRow>
            rows={historyRows(available)}
            columns={historyColumns}
          />
        </div>
      )}
    </Spacings.Stack>
  );

  /**
   * An action the payment cannot take is not offered at all — a disabled control with no explanation
   * asks the operator to work out WHY, and the answer ("this payment has no capture headroom left") is
   * already stated by the amount book above it. `undefined` means the row renders nothing.
   */
  const amountRow = (
    kind: ActionKind,
    buttonLabel: string,
    buttonClass: string
  ) => {
    if (!hasHeadroom(headroomOf[kind])) {
      return null;
    }
    const error = amountError(kind);
    return (
      <Spacings.Stack scale="xs">
        <div style={actionRowStyle}>
          <div style={amountBoxStyle}>
            {/* text, not number: the browser's number sanitization would strip the decimal comma
                before `parseAmount` ever saw it; `inputMode` still raises the numeric keypad. */}
            <input
              className="unzer-input"
              type="text"
              inputMode="decimal"
              aria-label={intl.formatMessage(amountLabelMessages[kind])}
              value={amounts[kind]}
              disabled={locked}
              onChange={(event) =>
                setAmounts((previous) => ({
                  ...previous,
                  [kind]: event.target.value,
                }))
              }
            />
            <span style={{ color: 'var(--unzer-grey)' }}>{currency}</span>
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={locked || error !== undefined}
            onClick={() => open(kind)}
          >
            {buttonLabel}
          </button>
        </div>
        {error !== undefined ? (
          <Text.Detail tone="critical">
            {amountErrorText(kind, error)}
          </Text.Detail>
        ) : null}
      </Spacings.Stack>
    );
  };

  // Rendered inside the OPEN dialog — the dialog's overlay dims and click-blocks the card, so an
  // answer shown only there would read as "nothing happened" with Confirm still armed. Once the
  // dialog is gone the same notification falls back to the card.
  const intentError = intent.error ? (
    <ContentNotification type="error">
      <Spacings.Inline scale="m" alignItems="center">
        <Text.Body>{formatProcessorError(intl, intent.error)}</Text.Body>
        {isConcurrentModification(intent.error) ? (
          <FlatButton
            label={intl.formatMessage(messages.refresh)}
            isDisabled={locked}
            onClick={refresh}
          />
        ) : null}
      </Spacings.Inline>
    </ContentNotification>
  ) : null;

  // Every body names the snapshot the confirm will submit. For a cancel that snapshot is the capture
  // headroom at open: the processor records the CancelAuthorization for exactly that figure — on a
  // partially captured payment, below the planned amount — or the dialog promises money the leg will
  // not book.
  const dialogBodyMessage: Record<ActionKind, MessageDescriptor> = {
    capture: messages.captureConfirmBody,
    refund: messages.refundConfirmBody,
    cancel: messages.cancelDialogBody,
  };
  const dialogTitle: Record<ActionKind, string> = {
    capture: intl.formatMessage(messages.captureDialogTitle),
    refund: intl.formatMessage(messages.refundDialogTitle),
    cancel: intl.formatMessage(messages.cancelDialogTitle),
  };
  const dialogAction = ({
    kind,
    amount,
  }: NonNullable<typeof dialog>): PaymentIntentActionDto => {
    if (kind === 'capture') return { action: 'capturePayment', amount };
    if (kind === 'refund') return { action: 'refundPayment', amount };
    // A cancel names its amount too: the operator may void part of what is still authorized, and the
    // seeded figure — the whole capture headroom — is what confirming it unchanged sends.
    return { action: 'cancelPayment', amount };
  };

  return (
    // The card is addressable by the payment it shows: the actions it offers now depend on that
    // payment's headroom, so a test (and an operator's DOM inspection) needs to scope to one card
    // rather than count controls across the panel.
    <div data-testid={`unzer-payment-card-${payment.id}`}>
      <Card type="raised" insetScale="l">
        <Spacings.Stack scale="l">
          <div className="unzer-panel-header" data-testid="unzer-panel-header">
            <UnzerLogo height={22} />
            <Text.Subheadline as="h4">
              {intl.formatMessage(messages.cardTitle)}
            </Text.Subheadline>
            {/* The identity survives an unavailable provider read - but only THEN. With the
              summary on screen the id is its own row, and repeating it here says it twice. */}
            {hasPaymentDetails(payment.details) ? null : (
              <Text.Detail tone="secondary">
                {intl.formatMessage(messages.paymentSectionTitle, {
                  payment: payment.providerPaymentId ?? payment.id,
                })}
              </Text.Detail>
            )}
            {payment.inReview ? (
              <Stamp
                tone="warning"
                isCondensed
                label={intl.formatMessage(messages.inReview)}
              />
            ) : null}
          </div>

          {hasPaymentDetails(payment.details) ? (
            <Fragment>
              {summary(payment.details)}
              {history(payment.details)}
            </Fragment>
          ) : (
            <ContentNotification type="warning">
              <Spacings.Inline scale="m" alignItems="center">
                <Text.Body>{payment.details.reason}</Text.Body>
                {/* A retry re-reads the provider, so it is offered only where there is something to
                  re-read: a payment that never reached the PSP fails the same way however often
                  the operator asks. */}
                {payment.providerPaymentId ? (
                  <FlatButton
                    label={intl.formatMessage(messages.retry)}
                    isDisabled={locked}
                    onClick={onRefresh}
                  />
                ) : null}
              </Spacings.Inline>
            </ContentNotification>
          )}

          {canCapture || canRefund || canCancel ? (
            <Spacings.Stack scale="s">
              {amountRow(
                'capture',
                intl.formatMessage(messages.captureButton),
                'unzer-btn unzer-btn--primary'
              )}
              {amountRow(
                'refund',
                intl.formatMessage(messages.refundButton),
                'unzer-btn unzer-btn--primary'
              )}
              {/* Cancelling voids what is still uncaptured — all of it by default, or the part the
                operator names, leaving the rest capturable. */}
              {amountRow(
                'cancel',
                intl.formatMessage(messages.cancelButton),
                'unzer-btn unzer-btn--dark'
              )}
            </Spacings.Stack>
          ) : null}

          {dialog ? null : intentError}
        </Spacings.Stack>

        {dialog ? (
          <ConfirmationDialog
            isOpen
            title={dialogTitle[dialog.kind]}
            labelPrimary={intl.formatMessage(messages.confirmButton)}
            labelSecondary={intl.formatMessage(messages.dismissButton)}
            isPrimaryButtonDisabled={
              intent.isPending || snapshotInvalid(dialog)
            }
            onConfirm={() => submit(dialogAction(dialog))}
            // The dialog cannot be dismissed while the operation is in flight. There is no
            // `isSecondaryButtonDisabled`, so the refusal is in the handlers: dismissing would hide the
            // one thing that says an operation is still happening, and the operator would be looking at
            // a card whose amounts have not moved yet with every control live again.
            onCancel={closeUnlessInFlight}
            onClose={closeUnlessInFlight}
          >
            <Spacings.Stack scale="m">
              <Text.Body>
                {intl.formatMessage(dialogBodyMessage[dialog.kind], {
                  amount: money(dialog.amount),
                })}
              </Text.Body>
              {intentError}
            </Spacings.Stack>
          </ConfirmationDialog>
        ) : null}
      </Card>
    </div>
  );
};
UnzerPaymentCard.displayName = 'UnzerPaymentCard';

export default UnzerPaymentCard;
