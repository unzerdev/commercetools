import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import { useCustomViewContext } from '@commercetools-frontend/application-shell-connectors';
import { NO_VALUE_FALLBACK } from '@commercetools-frontend/constants';
import PaymentsPanel from '../../../src/components/payments-panel';
import panelMessages from '../../../src/components/payments-panel/messages';
import coreCatalogue from '../../../src/i18n/data/core.json';
import deCatalogue from '../../../src/i18n/data/de.json';
import type { OrderPaymentsDto } from '../../../src/types/payments';
import type { ForwardCall, ForwardFetcher } from '../../util/forward-to';

/**
 * The panel end to end: the real components, the real query hooks and the real processor client,
 * with only the MC gateway transport stubbed. That is what makes the network assertions meaningful —
 * every card, summary cell and history row must come from the ONE panel read (spec AC2), an action
 * must cost exactly one POST plus the refetch its invalidation triggers, and an invalid amount must
 * cost none at all (prevented client-side before the processor's own 400).
 *
 * It is also where the operator's language is proven: a transport failure the processor never named
 * has to read in the operator's own catalogue, not in the transport's English, which only a render
 * through a non-default catalogue can show.
 */

jest.mock('@commercetools-frontend/application-shell', () => ({
  buildApiUrl: jest.fn((endpoint: string) => `https://mc-api.test${endpoint}`),
  executeHttpClientRequest: jest.fn(),
}));
jest.mock('@commercetools-frontend/application-shell-connectors', () => ({
  useCustomViewContext: jest.fn(),
}));

const executeMock = executeHttpClientRequest as jest.MockedFunction<
  typeof executeHttpClientRequest
>;
const useCustomViewContextMock = useCustomViewContext as jest.MockedFunction<
  typeof useCustomViewContext
>;

const PROCESSOR = 'https://processor.example.test';
const HOST_URL =
  'https://mc.europe-west1.gcp.commercetools.com/my-project/orders/order-1/payments';

const money = (centAmount: number) => ({ centAmount, currencyCode: 'EUR' });

/** The panel's own words for a refusal — what an approved or an accepted action must never show. */
const REFUSED_TEXT =
  'The payment provider refused this operation. No money was moved. The refreshed panel shows the amount that is available for this action.';

/** The same, in the operator's own catalogue — the only place a refusal is actually read. */
const REFUSED_TEXT_DE =
  'Der Zahlungsanbieter hat diesen Vorgang abgelehnt. Es wurde kein Geld bewegt. Das aktualisierte Panel zeigt den für diese Aktion verfügbaren Betrag.';

/** What the panel says instead of unmounting itself when the refresh — not the data — failed. */
const STALE_TEXT_DE =
  'Dieses Panel konnte nicht aktualisiert werden. Die Angaben unten stammen aus dem letzten erfolgreichen Abruf und sind möglicherweise nicht mehr aktuell. Die Zahlungsverbindung konnte nicht erreicht werden. (HTTP 502)';

/**
 * Money and dates as the operator's own locale renders them. The DOM matcher compares against
 * NORMALIZED text, so the narrow no-break spaces `Intl` emits have to be normalized here too.
 */
const formatCurrency = (locale: string, centAmount: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
    .format(centAmount / 100)
    .replace(/\s/g, ' ');

const formatEur = (centAmount: number) => formatCurrency('en', centAmount);

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(iso))
    .replace(/\s/g, ' ');

const AUTHORIZED_AT = '2026-07-01T10:15:00.000Z';

const CARD_PAYMENT = {
  id: 'payment-card',
  providerPaymentId: '3050000001',
  merchantReference: 'REF-1001',
  inReview: true,
  paymentMethod: 'card',
  amountPlanned: money(5000),
  fractionDigits: 2,
  capturableAmount: money(5000),
  refundableAmount: money(0),
  details: {
    rawStatus: 'PENDING_CAPTURE',
    // The connector stamps the CT payment id as the vendor's own order reference.
    orderId: 'payment-card',
    // `charged`/`cancelled`/`refunded` deliberately absent: their summary cells must fall back.
    amounts: { total: money(5000), authorized: money(5000) },
    operations: [
      {
        id: 'tx-aut-1',
        type: 'authorization',
        date: AUTHORIZED_AT,
        outcome: 'success' as const,
        amount: money(5000),
      },
    ],
  },
};

/**
 * An APM whose method code ships no logo: the method cell renders the label alone. Its one
 * leg carries an UNKNOWN type and no id/date/outcome/amount — the raw type renders, the bare cells
 * fall back, and no status pill is invented.
 */
const APM_PAYMENT = {
  id: 'payment-apm',
  providerPaymentId: '3050000002',
  inReview: false,
  paymentMethod: 'ideal',
  amountPlanned: money(2000),
  fractionDigits: 2,
  capturableAmount: money(0),
  refundableAmount: money(2000),
  details: {
    rawStatus: 'CAPTURED',
    operations: [{ type: 'payout' }],
  },
};

/** The provider read failed for this one: the card still renders it, actions included (spec AC4). */
const DEGRADED_PAYMENT = {
  id: 'payment-degraded',
  providerPaymentId: '3050000003',
  inReview: false,
  paymentMethod: 'card',
  amountPlanned: money(3000),
  fractionDigits: 2,
  capturableAmount: money(3000),
  refundableAmount: money(0),
  details: {
    unavailable: true as const,
    reason: 'the vendor could not be reached.',
  },
};

/**
 * The payment never reached the PSP: it carries no vendor reference at all, so the processor's read
 * of it fails permanently (`MissingProviderReference`) — a retry can never turn it into a status.
 */
const UNREFERENCED_PAYMENT = {
  id: 'payment-unreferenced',
  inReview: false,
  paymentMethod: 'card',
  amountPlanned: money(4000),
  fractionDigits: 2,
  capturableAmount: money(0),
  refundableAmount: money(0),
  details: {
    unavailable: true as const,
    reason: 'The payment has no provider reference to read.',
  },
};

/**
 * Partially captured: 10.00 of a planned 15.00 — the payment the cancel dialog must not lie about.
 * Its amount book is absent on the wire and its leg list empty, so every summary amount cell falls
 * back and the history area states the no-transactions text (nothing is invented from CT figures).
 */
const PARTIALLY_CAPTURED_PAYMENT = {
  id: 'payment-partial',
  providerPaymentId: '3050000004',
  inReview: false,
  paymentMethod: 'card',
  amountPlanned: money(1500),
  fractionDigits: 2,
  capturableAmount: money(500),
  refundableAmount: money(1000),
  details: { rawStatus: 'CAPTURE_REQUESTED', operations: [] },
};

const orderPayments: OrderPaymentsDto = {
  payments: [
    CARD_PAYMENT,
    APM_PAYMENT,
    DEGRADED_PAYMENT,
    UNREFERENCED_PAYMENT,
    PARTIALLY_CAPTURED_PAYMENT,
  ],
};

/**
 * The vendor promises no ordering for the leg list. Newest first here, with a dateless leg thrown
 * in: the summary's Date must still be the payment's FIRST leg date, not whichever leg arrived at
 * index 0.
 */
const NEWEST_FIRST_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...CARD_PAYMENT,
      details: {
        ...CARD_PAYMENT.details,
        operations: [
          {
            id: 'tx-chg-2',
            type: 'charge',
            date: '2026-07-02T09:00:00.000Z',
            outcome: 'success' as const,
            amount: money(2000),
          },
          { type: 'payout' },
          {
            id: 'tx-aut-1',
            type: 'authorization',
            date: AUTHORIZED_AT,
            outcome: 'success' as const,
            amount: money(5000),
          },
        ],
      },
    },
  ],
};

/**
 * A leg whose `date` is ISO-shaped but names no instant — month 13, day 45 — so `Date.parse` refuses it.
 * The wire declares a 256-character string and the processor exempts `date` from its scrub, so what the
 * vendor reports is what the panel gets.
 */
const MALFORMED_DATE_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...CARD_PAYMENT,
      details: {
        ...CARD_PAYMENT.details,
        operations: [
          {
            id: 'tx-aut-1',
            type: 'authorization',
            date: '2026-13-45T99:99:99Z',
            outcome: 'success' as const,
            amount: money(5000),
          },
        ],
      },
    },
  ],
};

/**
 * A payment in a currency the browser scales differently from commercetools: `Intl` resolves `RSD` at 0
 * minor digits, the panel read states 2. Every figure the card shows and the amount it posts must be at
 * the exponent the read states — 1,500.00 RSD capturable, and a 500.00 RSD capture is 50000 minor units.
 */
const RSD_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...CARD_PAYMENT,
      amountPlanned: { centAmount: 150000, currencyCode: 'RSD' },
      capturableAmount: { centAmount: 150000, currencyCode: 'RSD' },
      refundableAmount: { centAmount: 0, currencyCode: 'RSD' },
      details: {
        rawStatus: 'PENDING_CAPTURE',
        operations: [],
      },
    },
  ],
};

/** A leg whose outcome fell outside the wire union — what a vendor surprise looks like client-side. */
const UNKNOWN_OUTCOME_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...CARD_PAYMENT,
      details: {
        ...CARD_PAYMENT.details,
        operations: [
          {
            id: 'tx-weird-1',
            type: 'charge',
            date: AUTHORIZED_AT,
            outcome: 'weird' as never,
            amount: money(5000),
          },
        ],
      },
    },
  ],
};

/** The same panel with the card payment's capture headroom moved — what a background refetch lands. */
const withCardCapturable = (centAmount: number): OrderPaymentsDto => ({
  payments: orderPayments.payments.map((payment) =>
    payment.id === 'payment-card'
      ? { ...payment, capturableAmount: money(centAmount) }
      : payment
  ),
});

/**
 * The card payment as the processor holds it once a 20.00 capture was ACCEPTED but not settled: the
 * Unzer leg stands `pending`, and the headroom counts it spent — only the 30.00 that is left is
 * offered. This is what a `received` outcome looks like on the next read.
 */
const PENDING_CAPTURE_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...CARD_PAYMENT,
      capturableAmount: money(3000),
      details: {
        ...CARD_PAYMENT.details,
        operations: [
          ...CARD_PAYMENT.details.operations,
          {
            id: 'tx-chg-1',
            type: 'charge',
            date: '2026-07-01T10:20:00.000Z',
            outcome: 'pending' as const,
            amount: money(2000),
          },
        ],
      },
    },
  ],
};

/**
 * The panel once the processor recorded a REFUSED refund: the attempt is an `error` leg — the trace
 * the operator argues the support case from — and the money it never moved is available again.
 */
const REFUSED_REFUND_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...PARTIALLY_CAPTURED_PAYMENT,
      details: {
        ...PARTIALLY_CAPTURED_PAYMENT.details,
        operations: [
          {
            id: 'tx-ref-1',
            type: 'refund',
            date: '2026-07-01T10:25:00.000Z',
            outcome: 'error' as const,
            amount: money(1000),
          },
        ],
      },
    },
  ],
};

/**
 * The panel after an AMBIGUOUS failure: the processor never learned what the vendor did with the
 * refund, so it leaves the leg `pending` and keeps the headroom shut. The panel that still offered
 * the old refundable would invite the operator to refund money that may already be gone.
 */
const PENDING_REFUND_PANEL: OrderPaymentsDto = {
  payments: [
    {
      ...PARTIALLY_CAPTURED_PAYMENT,
      refundableAmount: money(0),
      details: {
        ...PARTIALLY_CAPTURED_PAYMENT.details,
        operations: [
          {
            id: 'tx-ref-2',
            type: 'refund',
            date: '2026-07-01T10:30:00.000Z',
            outcome: 'pending' as const,
            amount: money(1000),
          },
        ],
      },
    },
  ],
};

type FetchCall = [string, RequestInit];

/**
 * One card, addressed by the payment it shows. The panel no longer renders every action on every card
 * — an action without headroom is not offered at all — so counting controls across the panel and
 * indexing into them is not a stable way to reach a specific payment's button.
 */
const cardOf = (paymentId: string) =>
  within(screen.getByTestId(`unzer-payment-card-${paymentId}`));

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});

/** What a failing MC gateway actually returns: an HTML body naming no reason the panel could show. */
const gatewayFailureResponse = (status = 502) => ({
  ok: false,
  status,
  text: async () => '<html>Bad Gateway</html>',
  headers: { get: () => null },
});

/**
 * What the processor answers when the operation lost the version race: the payment moved under the
 * operator, nothing reached the vendor. Its own message is English — the panel must not show it.
 */
const concurrentModificationResponse = () =>
  jsonResponse(
    {
      message: 'The payment changed while the operation was reserved.',
      statusCode: 409,
      errors: [{ code: 'ConcurrentModification' }],
    },
    false,
    409
  );

/**
 * The vendor REFUSED the operation. the vendor's ordinary decline is not a thrown 4xx: it answers 200 and
 * puts the refusal in the body, with no message of its own — which is exactly why a panel that reads only
 * the HTTP status shows the operator an approval.
 */
const refusedResponse = () => jsonResponse({ outcome: 'rejected' });

/**
 * The vendor's OTHER refusal: the vendor threw a 4xx instead of answering 200, and the processor wraps it
 * as `ProviderRefusedOperation` — the SAME fault, releasing the SAME failure leg. It names its own
 * reason, so the panel does not word this one; what it must do is what it does for the 200-body refusal:
 * re-read, or the history would carry no trace of the attempt.
 */
const thrownRefusalResponse = () =>
  jsonResponse(
    {
      message: 'PSP API error (400): amount exceeds the refundable balance',
      statusCode: 400,
      errors: [
        {
          code: 'ProviderRefusedOperation',
          message: 'PSP API error (400): amount exceeds the refundable balance',
        },
      ],
    },
    false,
    400
  );

/**
 * The AMBIGUOUS outcome: the processor reached the vendor and never learned what it did. It fails closed
 * — the leg stays pending and the headroom stays shut — so the panel that does not re-read keeps
 * offering an amount the processor has already spoken for.
 */
const ambiguousFailureResponse = () =>
  jsonResponse(
    { message: 'Payment provider operation failed.', statusCode: 500 },
    false,
    500
  );

/** The vendor ACCEPTED the operation but has not settled it — the leg lands pending. */
const receivedResponse = () => jsonResponse({ outcome: 'received' });

/**
 * The panel's whole transport: a GET serves the panel, a POST answers an action. Successive GETs serve
 * successive panels — so a re-read can show what the action changed — and the last one repeats.
 */
const stubGateway = (
  intentResponse = jsonResponse({ outcome: 'approved' }),
  ...panelResponses: unknown[]
) => {
  const panels = panelResponses.length
    ? panelResponses
    : [jsonResponse(orderPayments)];
  let reads = 0;
  const fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') return intentResponse;
    const panel = panels[Math.min(reads, panels.length - 1)];
    reads += 1;
    return panel;
  });
  global.fetch = fetchMock as never;
  return fetchMock;
};

const callsWithMethod = (fetchMock: jest.Mock, method: string) =>
  (fetchMock.mock.calls as FetchCall[]).filter(
    ([, init]) => init.method === method
  );

/** The forward-to `uri` of the n-th processor call — the route the panel actually addressed. */
const forwardedUris = () =>
  (executeMock.mock.calls as ForwardCall[]).map(
    (call) => call[1].forwardToConfig.uri
  );

/**
 * The panel's own English defaults, keyed by id. They underlay every catalogue a render uses:
 * catalogue completeness is `load-messages.spec.ts`'s gate, not this suite's, and the preset's
 * fail-on-console guard must not read a catalogue that lags the id set as a panel fault. Every
 * translated string a test asserts still comes from the overlaid catalogue itself.
 */
const defaultsById = Object.fromEntries(
  Object.values(panelMessages).map((descriptor) => [
    descriptor.id as string,
    descriptor.defaultMessage as string,
  ])
);

/** The panel under one operator locale — `de` renders through the German catalogue the loader ships. */
const renderPanel = (
  locale = 'en',
  catalogue: Record<string, string> = coreCatalogue
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  return render(
    <IntlProvider locale={locale} messages={{ ...defaultsById, ...catalogue }}>
      <QueryClientProvider client={queryClient}>
        <PaymentsPanel />
      </QueryClientProvider>
    </IntlProvider>
  );
};

/** The card payment's id appears in its summary AND its history rows — any hit means rendered. */
const panelReady = () => screen.findAllByText('3050000001');

describe('PaymentsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildApiUrl as jest.Mock).mockImplementation(
      (endpoint: string) => `https://mc-api.test${endpoint}`
    );
    useCustomViewContextMock.mockImplementation((selector) =>
      selector({
        environment: { processorUrl: PROCESSOR },
        hostUrl: HOST_URL,
      } as never)
    );
    executeMock.mockImplementation(
      async (fetcher: ForwardFetcher) =>
        (
          await fetcher({
            credentials: 'include',
            headers: {},
          })
        ).data
    );
  });

  it('renders one Unzer card per payment — summary, history and method — from a single read', async () => {
    const fetchMock = stubGateway();
    renderPanel();

    await panelReady();

    // One card per connector payment, each carrying the Unzer header.
    const headers = screen.getAllByTestId('unzer-panel-header');
    expect(headers).toHaveLength(5);
    expect(headers[0]).toHaveClass('unzer-panel-header');
    expect(screen.getAllByText('Unzer Payments')).toHaveLength(5);
    expect(screen.getByText('Under review')).toBeInTheDocument();

    // Only the three payments the provider read succeeded on render a summary (spec AC4).
    const summaries = screen.getAllByTestId('unzer-summary');
    expect(summaries).toHaveLength(3);

    // The card payment's summary: the vendor's own read — its state, order id and amount book —
    // plus the two fields that name what it answered ABOUT. Absent figures fall back, never invented.
    const cardSummary = within(summaries[0]);
    expect(
      cardSummary.getByText(formatDateTime(AUTHORIZED_AT))
    ).toBeInTheDocument();
    expect(cardSummary.getByText('3050000001')).toBeInTheDocument();
    expect(cardSummary.getByText('payment-card')).toBeInTheDocument();
    // The merchant reference is commercetools' own and no longer belongs in a vendor summary.
    expect(cardSummary.queryByText('REF-1001')).toBeNull();
    // The method reads as its product NAME, never the routing code the wire carries.
    expect(cardSummary.getByText('Card')).toBeInTheDocument();
    expect(cardSummary.queryByText('card')).toBeNull();
    // The logo is the processor's own asset, not a bundled copy — one route, every method.
    expect(
      within(summaries[0]).getByTestId('unzer-method-logo')
    ).toHaveAttribute('src', `${PROCESSOR}/assets/method-logo/card`);
    expect(cardSummary.getAllByText(formatEur(5000))).toHaveLength(2);
    expect(cardSummary.getAllByText(NO_VALUE_FALLBACK)).toHaveLength(3);

    // A method whose code the panel has no name for still resolves through the same route.
    const apmSummary = within(summaries[1]);
    expect(apmSummary.getByText('iDEAL')).toBeInTheDocument();

    // The partial payment's book is absent and its leg list empty: Date, Order ID and all five
    // amount cells fall back, and the history area states the no-transactions text.
    const partialSummary = within(summaries[2]);
    expect(partialSummary.getByText('3050000004')).toBeInTheDocument();
    expect(partialSummary.getAllByText(NO_VALUE_FALLBACK)).toHaveLength(7);
    expect(
      screen.getByText(
        'No transactions have been recorded for this payment yet.'
      )
    ).toBeInTheDocument();
    // The section is named on every card the provider read succeeded on — including the one whose leg
    // list is empty, which still has to say WHAT it has nothing of.
    expect(screen.getAllByText('Transactions')).toHaveLength(3);

    // The history tables render the Unzer legs: transaction id, catalogue-labelled type,
    // outcome pill; an unknown leg type renders the raw vendor string with no pill invented.
    const tables = screen.getAllByTestId('unzer-history');
    expect(tables).toHaveLength(2);
    const cardTable = within(tables[0]);
    expect(cardTable.getByText('tx-aut-1')).toBeInTheDocument();
    expect(cardTable.getByText('Authorization')).toBeInTheDocument();
    expect(cardTable.getByText('Success')).toHaveClass(
      'unzer-status',
      'unzer-status--success'
    );
    expect(cardTable.getByText(formatEur(5000))).toBeInTheDocument();
    const apmTable = within(tables[1]);
    expect(apmTable.getByText('payout')).toBeInTheDocument();
    expect(apmTable.queryByText('Success')).toBeNull();
    expect(apmTable.queryByText('Pending')).toBeNull();
    expect(apmTable.queryByText('Error')).toBeNull();

    // The whole of the above cost ONE processor read (spec AC2).
    expect(forwardedUris()).toEqual([
      `${PROCESSOR}/operations/orders/order-1/payments`,
    ]);
    expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(1);
  });

  /**
   * The summary now reports the vendor's own payment STATE and the currency its amounts are in. The
   * state is a verbatim vendor lift, so it is labelled where the panel knows the name Unzer documents
   * and passed through where it does not — a state the vendor adds later must still render.
   */
  it.each([
    ['completed', 'Completed'],
    ['payment_review', 'Payment review'],
    ['chargeback', 'Chargeback'],
    ['a-state-unzer-added-later', 'a-state-unzer-added-later'],
  ])('labels the vendor state %s as %s', async (rawStatus, expected) => {
    stubGateway(
      undefined,
      jsonResponse({
        payments: [
          { ...CARD_PAYMENT, details: { ...CARD_PAYMENT.details, rawStatus } },
        ],
      })
    );

    renderPanel();
    await panelReady();

    const summary = within(screen.getByTestId('unzer-summary'));
    expect(summary.getByText('State')).toBeInTheDocument();
    expect(summary.getByText(expected)).toBeInTheDocument();
    expect(summary.getByText('Currency')).toBeInTheDocument();
    expect(summary.getByText('EUR')).toBeInTheDocument();
  });

  // The method is a routing code on the wire; the panel owes the operator a product name. A code this
  // release has no name for still renders — as the code — rather than as a blank or a crash.
  it.each([
    ['openbanking-pis', 'Open Banking'],
    ['sepa-direct-debit', 'SEPA Direct Debit'],
    ['przelewy24', 'Przelewy24'],
    ['a-method-added-after-this-release', 'a-method-added-after-this-release'],
  ])('names the method %s as %s', async (paymentMethod, expected) => {
    stubGateway(
      undefined,
      jsonResponse({ payments: [{ ...CARD_PAYMENT, paymentMethod }] })
    );

    renderPanel();
    await panelReady();

    expect(
      within(screen.getByTestId('unzer-summary')).getByText(expected)
    ).toBeInTheDocument();
  });

  // Every method resolves its logo through the processor's own asset route, whatever its code — there
  // is no second source. The route answers 404 for artwork it does not ship, and the image drops
  // itself rather than leaving a broken frame; the NAME never depends on it.
  it('points every method logo at the processor asset route', async () => {
    stubGateway(
      undefined,
      jsonResponse({
        payments: [{ ...CARD_PAYMENT, paymentMethod: 'openbanking-pis' }],
      })
    );

    renderPanel();
    await panelReady();

    expect(
      within(screen.getByTestId('unzer-summary')).getByTestId(
        'unzer-method-logo'
      )
    ).toHaveAttribute('src', `${PROCESSOR}/assets/method-logo/openbanking-pis`);
  });

  it('shows the earliest leg date in the summary, whatever order the legs arrive in', async () => {
    stubGateway(undefined, jsonResponse(NEWEST_FIRST_PANEL));

    renderPanel();
    await panelReady();

    const summary = within(screen.getByTestId('unzer-summary'));
    expect(
      summary.getByText(formatDateTime(AUTHORIZED_AT))
    ).toBeInTheDocument();
  });

  // The wire union is the processor's promise, not the browser's guarantee: an outcome outside it
  // must degrade to a pill-less row, never to a formatMessage(undefined) crash blanking the panel.
  it('renders a leg whose outcome is outside the wire union with no pill and no crash', async () => {
    stubGateway(undefined, jsonResponse(UNKNOWN_OUTCOME_PANEL));

    renderPanel();
    await panelReady();

    const table = within(screen.getByTestId('unzer-history'));
    expect(table.getByText('tx-weird-1')).toBeInTheDocument();
    expect(table.queryByText('Success')).toBeNull();
    expect(table.queryByText('Pending')).toBeNull();
    expect(table.queryByText('Error')).toBeNull();
    expect(table.queryByText('weird')).toBeNull();
  });

  /**
   * An unparseable vendor date is a value, not a format the panel may invent: passed to
   * `intl.formatDate` it renders the literal `Invalid Date` in the summary and in the history row, and
   * raises a react-intl error. It falls back exactly as an absent date does.
   */
  it('falls back for a vendor date the browser cannot parse', async () => {
    stubGateway(undefined, jsonResponse(MALFORMED_DATE_PANEL));

    renderPanel();
    await panelReady();

    // `intl.formatDate` cannot format it: it raises its own error and renders the literal `Invalid Date`.
    expect(screen.queryAllByText('Invalid Date')).toHaveLength(0);
    // The summary derives its Date from the same legs, so its Date cell falls back too — joining the
    // three amount cells this fixture reports no figure for (charged, cancelled, refunded).
    expect(
      within(screen.getByTestId('unzer-summary')).getAllByText(
        NO_VALUE_FALLBACK
      )
    ).toHaveLength(4);
    expect(
      within(screen.getByTestId('unzer-history')).getByText(NO_VALUE_FALLBACK)
    ).toBeInTheDocument();
  });

  it('states why the provider details are unavailable, keeps the identity and the actions, and offers a retry', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    expect(
      screen.getByText('the vendor could not be reached.')
    ).toBeInTheDocument();

    // The card still says WHICH payment it is (spec AC4) — the id alone, unprefixed.
    expect(screen.getByText('3050000003')).toBeInTheDocument();

    // ...and its capture headroom comes from commercetools, not from the failed provider read,
    // so the action stays available. The degraded payment is the third card.
    expect(screen.getAllByRole('button', { name: 'Capture' })[2]).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );
  });

  // A retry re-reads the provider. A payment that never reached the provider has nothing to re-read:
  // its card states the condition, but offering a retry would promise a status that can never arrive.
  it('offers the retry only for a payment that has a provider reference to re-read', async () => {
    stubGateway();

    renderPanel();
    await panelReady();

    // Both provider reads failed, so both cards say so...
    expect(
      screen.getByText('the vendor could not be reached.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('The payment has no provider reference to read.')
    ).toBeInTheDocument();

    // ...but only the one the processor could retry offers the button.
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  // An action the payment cannot take is not offered at all. A disabled control with no explanation
  // asks the operator to work out WHY, and the amount book above it has already said so.
  it('hides an action whose headroom is zero, rather than disabling it', async () => {
    stubGateway();

    renderPanel();
    await panelReady();

    // The card payment has nothing refunded yet; the fully captured APM has nothing left to capture.
    const cardCards = screen.getAllByTestId('unzer-panel-header');
    expect(cardCards.length).toBeGreaterThan(1);

    const captureButtons = screen.getAllByRole('button', { name: 'Capture' });
    const refundButtons = screen.queryAllByRole('button', { name: 'Refund' });
    // Fewer of each than there are payments — the ones without headroom render nothing at all.
    expect(captureButtons.length).toBeLessThan(orderPayments.payments.length);
    expect(refundButtons.length).toBeLessThan(orderPayments.payments.length);
    // Whatever is offered is offered live: no action is rendered in a disabled state.
    [...captureButtons, ...refundButtons].forEach((button) =>
      expect(button).toBeEnabled()
    );
  });

  // Each amount input names the action it feeds: an order with N cards exposes N capture and N
  // refund textboxes, and a screen-reader operator must be able to tell which money-moving action
  // a given input belongs to — a shared "Amount" cannot.
  it('gives every capture and refund input an action-specific accessible name', async () => {
    stubGateway();

    renderPanel();
    await panelReady();

    // One input per OFFERED action — an action without headroom renders neither button nor input.
    const captureInputs = screen.getAllByRole('textbox', {
      name: 'Capture amount',
    });
    const refundInputs = screen.getAllByRole('textbox', {
      name: 'Refund amount',
    });
    expect(captureInputs).toHaveLength(
      screen.getAllByRole('button', { name: 'Capture' }).length
    );
    expect(refundInputs).toHaveLength(
      screen.getAllByRole('button', { name: 'Refund' }).length
    );
    expect(captureInputs.length).toBeGreaterThan(0);
    expect(refundInputs.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('textbox', { name: /^Amount$/ })
    ).not.toBeInTheDocument();
  });

  it('blocks a capture above the capturable amount before it reaches the processor', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    // The first capture input is the card payment's, seeded with its full headroom.
    const amountInput = screen.getAllByRole('textbox', {
      name: 'Capture amount',
    })[0];
    expect(amountInput).toHaveValue('50');

    fireEvent.change(amountInput, { target: { value: '80' } });

    expect(
      screen.getByText(
        `The amount exceeds the ${formatEur(5000)} available for this action.`
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Capture' })[0]
    ).toBeDisabled();
    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(0);
  });

  it('blocks a non-positive amount before it reaches the processor', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '0' },
      }
    );

    expect(
      screen.getByText('Enter an amount greater than zero.')
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Capture' })[0]
    ).toBeDisabled();
    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(0);
  });

  /**
   * `Number` accepts far more than a decimal, and a string `replace` swaps only the FIRST comma: a
   * thousands-separated `1,234` reads as 1.234 → 123 cents, `10,505` as 10.505 → 1051 cents, `0x10` as
   * 16 → 1600 cents. Each is a figure the operator never typed, and each was submittable with no
   * warning. Anything outside the currency's own decimal grammar is refused, not coerced.
   */
  it('refuses an amount outside the currency decimal grammar instead of coercing it', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    const amountInput = screen.getAllByRole('textbox', {
      name: 'Capture amount',
    })[0];
    const captureButton = () =>
      screen.getAllByRole('button', { name: 'Capture' })[0];

    fireEvent.change(amountInput, { target: { value: '1,234' } });
    expect(captureButton()).toBeDisabled();
    // The refusal names the format the input accepts, at this payment's own two minor digits — telling the
    // operator to "enter an amount greater than zero" would describe a figure they did not type.
    expect(
      screen.getByText(
        'Enter the amount as digits with at most 2 decimal places, for example 10.00.'
      )
    ).toBeInTheDocument();
    // The coerced figure never reaches a confirmation the operator could approve.
    expect(
      screen.queryByText(
        `The payment provider will be asked to capture ${formatEur(123)}.`
      )
    ).not.toBeInTheDocument();

    // A third decimal on a two-decimal currency is a typo, not a figure to round to 10.51.
    fireEvent.change(amountInput, { target: { value: '10,505' } });
    expect(captureButton()).toBeDisabled();

    fireEvent.change(amountInput, { target: { value: '0x10' } });
    expect(captureButton()).toBeDisabled();

    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(0);
  });

  /**
   * The scale of every figure on a card is the `fractionDigits` the read carries for that payment, not
   * one the browser resolves: `Intl` gives `RSD` zero minor digits, so a locally resolved scale would
   * seed the input with 150000, render RSD 150,000, and post 500 minor units — 5.00 RSD — for a capture
   * the operator entered as 500.
   */
  it('renders and posts at the exponent the read states for the payment', async () => {
    const fetchMock = stubGateway(undefined, jsonResponse(RSD_PANEL));

    renderPanel();
    await panelReady();

    const amountInput = screen.getByRole('textbox', { name: 'Capture amount' });
    expect(amountInput).toHaveValue('1500');
    // The cancel row draws on the same headroom and is seeded at the same stated exponent.
    expect(screen.getByRole('textbox', { name: 'Cancel amount' })).toHaveValue(
      '1500'
    );

    fireEvent.change(amountInput, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(
      await screen.findByText(
        'The payment provider will be asked to capture RSD 500.00.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'capturePayment',
          amount: { centAmount: 50000, currencyCode: 'RSD' },
        },
      ],
    });
  });

  it('captures the typed amount after a confirmation naming it, and refetches the panel', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '20' },
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);

    // The confirmation names the EXACT amount the processor will be asked for.
    expect(
      await screen.findByText(
        `The payment provider will be asked to capture ${formatEur(2000)}.`
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'capturePayment',
          amount: { centAmount: 2000, currencyCode: 'EUR' },
        },
      ],
    });
    expect(forwardedUris()).toContain(
      `${PROCESSOR}/operations/payments/payment-card/intents`
    );

    // The action invalidates the order's cache entry, so the panel re-reads instead of patching itself.
    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );

    // The vendor performed it: the dialog closes and the operator is shown no refusal.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirm' })
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByText(REFUSED_TEXT)).not.toBeInTheDocument();
  });

  /**
   * The decimal comma is the operator's own separator. A `type="number"` input would sanitize the
   * comma away in a real browser before `parseAmount` ever saw it — only a text input with a decimal
   * `inputMode` lets `10,50` reach the parser, the confirmation and the wire as 10.50.
   */
  it('accepts a decimal-comma amount, names it in the confirmation, and posts its cent value', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '10,50' },
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);

    expect(
      await screen.findByText(
        `The payment provider will be asked to capture ${formatEur(1050)}.`
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'capturePayment',
          amount: { centAmount: 1050, currencyCode: 'EUR' },
        },
      ],
    });
  });

  /**
   * A background refetch re-seeds the amount inputs WHILE a dialog stands open. The dialog holds the
   * MoneyDto snapshotted at open — never a live read of the input — so the figure it names and the
   * figure it submits cannot swap under the operator between open and confirm.
   */
  it('submits the amount the dialog was opened with, not the amount a background refetch re-seeded', async () => {
    const fetchMock = stubGateway(
      undefined,
      jsonResponse(orderPayments),
      jsonResponse(withCardCapturable(3000))
    );

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '20' },
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText(
        `The payment provider will be asked to capture ${formatEur(2000)}.`
      )
    ).toBeInTheDocument();

    // The degraded card's Retry re-reads the panel behind the open dialog; the fresh read re-seeds
    // the capture input with its new headroom.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('textbox', { name: 'Capture amount' })[0]
      ).toHaveValue('30')
    );

    // The dialog still names the snapshot...
    expect(
      dialog.getByText(
        `The payment provider will be asked to capture ${formatEur(2000)}.`
      )
    ).toBeInTheDocument();

    // ...and submits exactly it.
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'capturePayment',
          amount: { centAmount: 2000, currencyCode: 'EUR' },
        },
      ],
    });
  });

  // The belt for the stale-open dialog: when the refreshed headroom no longer covers the snapshot,
  // the confirm is disarmed instead of submitting money the processor would 400 — or worse, honor.
  it('disables the confirm of a stale-open dialog whose snapshot the refreshed headroom no longer covers', async () => {
    const fetchMock = stubGateway(
      undefined,
      jsonResponse(orderPayments),
      jsonResponse(withCardCapturable(500))
    );

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '20' },
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('textbox', { name: 'Capture amount' })[0]
      ).toHaveValue('5')
    );

    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Confirm',
      })
    ).toBeDisabled();
    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(0);
  });

  /**
   * The vendor's REFUSAL arrives as a 200 — the vendor declines in the body, not in the status — so
   * react-query calls it a success and, unread, it would close the dialog and say nothing: the operator
   * would see exactly what an approved refund looks like. Rendered through the German catalogue, because
   * a refusal worded in English at the render site must not be able to pass this.
   */
  it('reads a vendor refusal in a 200 body as a failure the operator sees, and does not close the dialog', async () => {
    const fetchMock = stubGateway(refusedResponse());

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Erstatten' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    // INSIDE the open dialog: the card sits behind the dialog's full-viewport overlay, so a refusal
    // rendered only there would be one the operator cannot see.
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText(REFUSED_TEXT_DE)).toBeInTheDocument();

    // The operator stays in front of the answer — a dialog that closed would read as an approval.
    expect(
      dialog.getByRole('button', { name: 'Bestätigen' })
    ).toBeInTheDocument();

    // The refusal is an ANSWER: the processor recorded the failed attempt, so the panel re-reads —
    // or the history would carry no trace of it.
    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );
    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1);
  });

  /**
   * The re-read a refusal fires can itself fail. A failed BACKGROUND refetch flips the query to `error`
   * while KEEPING the data it already had — so a panel that reads `error` before `data` tears itself
   * down, the dialog with it, and tells an operator the acquirer has just declined that the connector is
   * unreachable. The data below is still true; only the refresh failed, and that is what it must say.
   */
  it('keeps the refusal, and the panel, when the re-read it fires fails', async () => {
    const fetchMock = stubGateway(
      refusedResponse(),
      jsonResponse(orderPayments),
      gatewayFailureResponse()
    );

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Erstatten' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );

    // The failed refresh is stated as a failed refresh, above a panel that is still standing...
    expect(await screen.findByText(STALE_TEXT_DE)).toBeInTheDocument();
    expect(screen.getAllByText('3050000001').length).toBeGreaterThan(0);

    // ...and the answer the operator was reading is still the answer in front of them — inside the
    // dialog they are standing in, not on the card behind its overlay.
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(REFUSED_TEXT_DE)).toBeInTheDocument();
    expect(
      dialog.getByRole('button', { name: 'Bestätigen' })
    ).toBeInTheDocument();
  });

  /**
   * the vendor refuses in TWO shapes, and the processor treats them as ONE fault: the 200 body above, and
   * a thrown 4xx it wraps as `ProviderRefusedOperation` — releasing the same failure leg. The panel owes
   * both the same answer. This one names its own reason, so the panel shows the processor's words; what it
   * must not do is leave the refused attempt out of the history the operator argues from.
   */
  it('re-reads a vendor refusal the processor raises as a 4xx, exactly as it re-reads the 200-body one', async () => {
    const fetchMock = stubGateway(
      thrownRefusalResponse(),
      jsonResponse(orderPayments),
      jsonResponse(REFUSED_REFUND_PANEL)
    );

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Erstatten' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    expect(
      await within(screen.getByRole('dialog')).findByText(
        'PSP API error (400): amount exceeds the refundable balance'
      )
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );

    // The refused attempt is on the record as an error leg, and the money it never moved is
    // available again.
    expect(
      await screen.findByText(deCatalogue['PaymentsPanel.legTypeRefund'])
    ).toBeInTheDocument();
    expect(
      screen.getByText(deCatalogue['PaymentsPanel.statusError'])
    ).toHaveClass('unzer-status--error');
    expect(
      screen.getAllByRole('button', { name: 'Erstatten' })[0]
    ).toBeEnabled();
  });

  /**
   * The AMBIGUOUS outcome: the processor reached the vendor and never learned what it did, so it fails
   * closed — the leg stands pending and the headroom is shut. A panel that does not re-read keeps
   * offering the refundable of the read before the attempt: money the processor has already spoken for,
   * and that the vendor may already have paid out.
   */
  it('re-reads after an ambiguous failure, so the operator sees the headroom the processor actually left', async () => {
    const fetchMock = stubGateway(
      ambiguousFailureResponse(),
      jsonResponse(orderPayments),
      jsonResponse(PENDING_REFUND_PANEL)
    );

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Erstatten' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Payment provider operation failed.'
      )
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );

    // The standing leg is on screen, and the amount it holds is no longer offered — the action is
    // WITHDRAWN, not greyed out: the headroom the re-read reports is zero, so there is nothing to offer.
    expect(
      await screen.findByText(deCatalogue['PaymentsPanel.statusPending'])
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Erstatten' })
      ).not.toBeInTheDocument()
    );
  });

  /**
   * `received` is the vendor ACCEPTING an operation it has not settled. It is not a refusal and not a
   * fault: there is nothing for the operator to fix and nothing to re-send, so it closes the dialog like
   * any accepted action — and the truth is told where the panel tells every other truth, the re-read:
   * the history carries the leg as pending, and the re-seeded capture input offers only what is left.
   */
  it('reads an accepted-but-unsettled outcome as accepted, and the re-read states that it is pending', async () => {
    const fetchMock = stubGateway(
      receivedResponse(),
      jsonResponse(orderPayments),
      jsonResponse(PENDING_CAPTURE_PANEL)
    );

    renderPanel();
    await panelReady();

    fireEvent.change(
      screen.getAllByRole('textbox', { name: 'Capture amount' })[0],
      {
        target: { value: '20' },
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirm' })
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByText(REFUSED_TEXT)).not.toBeInTheDocument();

    // The re-read says what the outcome was: the leg stands unsettled...
    expect(await screen.findByText('Charge')).toBeInTheDocument();
    expect(
      screen.getByText(coreCatalogue['PaymentsPanel.statusPending'])
    ).toHaveClass('unzer-status--pending');

    // ...and the money it holds is already spent — the re-seeded input offers only the 30.00 that
    // is left, so the operator cannot capture the same 20.00 again.
    await waitFor(() =>
      expect(
        screen.getAllByRole('textbox', { name: 'Capture amount' })[0]
      ).toHaveValue('30')
    );
  });

  it('surfaces a processor rejection as its own message', async () => {
    stubGateway(
      jsonResponse(
        { message: 'The requested amount exceeds the remaining 5000 EUR.' },
        false,
        400
      )
    );

    renderPanel();
    await panelReady();
    fireEvent.click(screen.getAllByRole('button', { name: 'Capture' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(
      await within(screen.getByRole('dialog')).findByText(
        'The requested amount exceeds the remaining 5000 EUR.'
      )
    ).toBeInTheDocument();
  });

  // The gateway's own failure names no reason the panel could show, so the panel must supply the
  // words — from the operator's catalogue, not from the transport.
  it('states a failed panel read in the operator language', async () => {
    stubGateway(undefined, gatewayFailureResponse());

    renderPanel('de', deCatalogue);

    expect(
      await screen.findByText(
        'Die Zahlungsverbindung konnte nicht erreicht werden. (HTTP 502)'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeInTheDocument();
  });

  it('states a failed action in the operator language', async () => {
    stubGateway(gatewayFailureResponse());

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(screen.getAllByRole('button', { name: 'Einziehen' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Die Zahlungsverbindung konnte nicht erreicht werden. (HTTP 502)'
      )
    ).toBeInTheDocument();
  });

  // A failure that never produced a response carries only the browser's English `Failed to fetch`, so
  // the panel must supply the words for this one too.
  it('states a read that produced no response at all in the operator language', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as never;

    renderPanel('de', deCatalogue);

    expect(
      await screen.findByText(
        'Die Zahlungsverbindung ist nicht erreichbar. Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut.'
      )
    ).toBeInTheDocument();
  });

  // The 409 is an ANSWER, not a fault: the payment moved and NOTHING reached the vendor. Reading it as
  // "the payment provider failed" would send the operator hunting a PSP outage that does not exist.
  it('reads a lost version race as the payment having moved, and offers the re-read', async () => {
    const fetchMock = stubGateway(concurrentModificationResponse());

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(screen.getAllByRole('button', { name: 'Einziehen' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    // The answer renders where the operator is standing — inside the dialog, not on the card its
    // overlay covers.
    const dialog = within(screen.getByRole('dialog'));
    expect(
      await dialog.findByText(
        'Diese Zahlung hat sich zwischenzeitlich geändert. Es wurde nichts an den Zahlungsanbieter gesendet. Aktualisieren Sie das Panel und versuchen Sie es erneut.'
      )
    ).toBeInTheDocument();
    // The processor's own English wording never reaches the operator.
    expect(
      screen.queryByText(
        'The payment changed while the operation was reserved.'
      )
    ).not.toBeInTheDocument();

    // The settled action re-read the panel behind the dialog...
    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );

    // ...and the affordance the answer calls for — offered where it can be clicked — dismisses the
    // dialog holding the stale headroom, on the amounts the payment holds at the moment the operator
    // asks for them.
    fireEvent.click(
      dialog.getByRole('button', { name: 'Panel aktualisieren' })
    );

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(3)
    );
    expect(
      screen.queryByRole('button', { name: 'Bestätigen' })
    ).not.toBeInTheDocument();

    // With the dialog gone the answer falls back to the card, so it survives the dismissal.
    expect(
      screen.getByText(
        'Diese Zahlung hat sich zwischenzeitlich geändert. Es wurde nichts an den Zahlungsanbieter gesendet. Aktualisieren Sie das Panel und versuchen Sie es erneut.'
      )
    ).toBeInTheDocument();
  });

  // Anything else the processor did not name IS a failure of the connector, and it must keep reading as
  // one — the refresh affordance belongs to the 409 alone.
  it('keeps a processor failure generic, and offers no re-read for it', async () => {
    stubGateway(gatewayFailureResponse(500));

    renderPanel('de', deCatalogue);
    await panelReady();
    fireEvent.click(screen.getAllByRole('button', { name: 'Einziehen' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Die Zahlungsverbindung konnte nicht erreicht werden. (HTTP 500)'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Panel aktualisieren' })
    ).not.toBeInTheDocument();
  });

  // The processor records the `CancelAuthorization` for the CAPTURE HEADROOM — the amount it actually
  // voids — so a dialog naming the planned amount would promise 15.00 where the transaction row books
  // 5.00. Rendered through the German catalogue, because a figure hardcoded into the English default
  // must not be able to pass this.
  it('states the capture headroom the cancellation is recorded for, never the planned amount', async () => {
    stubGateway();

    renderPanel('de', deCatalogue);
    await panelReady();

    // The partially captured payment: 10.00 of a planned 15.00 taken, 5.00 still capturable.
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Stornieren' })
    );

    expect(
      await screen.findByText(
        `Durch das Stornieren wird die verbleibende Autorisierung aufgehoben: Es kann nichts mehr eingezogen werden. Die Stornierung wird für die noch einziehbaren ${formatCurrency(
          'de',
          500
        )} erfasst.`
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/15,00/)).not.toBeInTheDocument();
  });

  /**
   * The cancel intent carries NO amount: the processor voids the whole remaining authorization, and the
   * headroom the dialog names is display only. An intent that carried one would be a capture of exactly
   * the money the operator asked to void — the same request body with a different `action` — so the body
   * is asserted member for member, not just the POST count.
   */
  /**
   * An operation on its way to the vendor is money in an unknown state, and the panel still shows the
   * amounts it was decided against. Nothing may be started in that window, and the dialog that says it
   * is happening may not be dismissed — dismissing would hand back a card whose figures have not moved
   * with every control live again, which is exactly how the same refund gets sent twice.
   */
  it('locks the card and shows a spinner while an action is in flight, and refuses to be dismissed', async () => {
    // A gateway call that never settles: the mutation stays pending for the whole assertion.
    stubGateway(new Promise(() => {}) as never);

    renderPanel();
    await panelReady();

    const card = cardOf('payment-partial');
    fireEvent.click(card.getByRole('button', { name: 'Capture' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    const dialog = within(await screen.findByRole('dialog'));
    // A blocking overlay covers everything, the dialog included — it is portalled to the body for
    // exactly that reason. It carries a spinner and no words: what it means is that nothing responds.
    expect(
      await screen.findByTestId('unzer-blocking-overlay')
    ).toBeInTheDocument();
    // Confirm cannot be pressed again...
    expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();

    // ...and dismissing does nothing while it is out.
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Behind the dialog every action is inert — including on the OTHER cards, whose headroom the
    // re-read will refresh too.
    screen
      .getAllByRole('button', { name: 'Capture' })
      .forEach((button) => expect(button).toBeDisabled());
    screen
      .getAllByRole('textbox', { name: 'Capture amount' })
      .forEach((input) => expect(input).toBeDisabled());
  });

  // A cancel may now void PART of what is still authorized, leaving the rest capturable — the same
  // shape a capture or a refund has, seeded with its full headroom so the default stays "void it all".
  it('posts a partial cancel for the amount the operator typed', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    const card = cardOf('payment-partial');
    fireEvent.change(card.getByRole('textbox', { name: 'Cancel amount' }), {
      target: { value: '2' },
    });
    fireEvent.click(card.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'cancelPayment',
          amount: { centAmount: 200, currencyCode: 'EUR' },
        },
      ],
    });
  });

  // The ceiling is the CAPTURE headroom: a void beyond it would release money already taken.
  it('refuses a cancel above the capture headroom without sending it', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    const card = cardOf('payment-partial');
    fireEvent.change(card.getByRole('textbox', { name: 'Cancel amount' }), {
      target: { value: '99' },
    });

    expect(card.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(0);
  });

  it('posts a cancel intent carrying the amount the operator left standing', async () => {
    const fetchMock = stubGateway();

    renderPanel();
    await panelReady();

    // The partially captured payment: 10.00 of a planned 15.00 taken, 5.00 still capturable.
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Cancel' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'POST')).toHaveLength(1)
    );
    const [, postInit] = callsWithMethod(fetchMock, 'POST')[0];
    // Confirmed unchanged, the seeded figure IS the whole capture headroom — the same void a cancel
    // without an amount performed, now stated explicitly so a PARTIAL one can be stated too.
    expect(JSON.parse(postInit.body as string)).toEqual({
      actions: [
        {
          action: 'cancelPayment',
          amount: { centAmount: 500, currencyCode: 'EUR' },
        },
      ],
    });
    expect(forwardedUris()).toContain(
      `${PROCESSOR}/operations/payments/payment-partial/intents`
    );

    // An accepted action re-reads the panel and closes the dialog.
    await waitFor(() =>
      expect(callsWithMethod(fetchMock, 'GET')).toHaveLength(2)
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Confirm' })
      ).not.toBeInTheDocument()
    );
  });

  /**
   * A failed attempt stays on the card's mutation until the next action resets it. Without the reset in
   * `open`, the refund dialog the operator opens NEXT renders the capture's failure — an error against a
   * request that was never sent, on money that was never touched.
   */
  it('opens the next action free of the failure the operator already dismissed', async () => {
    stubGateway(gatewayFailureResponse());

    renderPanel();
    await panelReady();

    // The partially captured payment is the one card with both a capture and a refund headroom.
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Capture' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    const failureText =
      'Something went wrong reaching the payment connector. (HTTP 502)';
    expect(
      await within(screen.getByRole('dialog')).findByText(failureText)
    ).toBeInTheDocument();

    // Dismissed: the dialog is gone and the answer falls back to the card behind it.
    // Scoped to the dialog: the card's own cancel ACTION now carries the same short label, and the
    // dialog's dismiss is the one meant here.
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );
    expect(screen.getByText(failureText)).toBeInTheDocument();

    // The refund the operator opens next has sent nothing, so it must show nothing.
    fireEvent.click(
      cardOf('payment-partial').getByRole('button', { name: 'Refund' })
    );
    const refundDialog = within(await screen.findByRole('dialog'));
    expect(refundDialog.queryByText(failureText)).not.toBeInTheDocument();
    expect(screen.queryByText(failureText)).not.toBeInTheDocument();
  });
});
