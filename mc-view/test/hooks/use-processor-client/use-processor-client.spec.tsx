/**
 * `useProcessorClient` forward-to wiring. The view's ONLY channel to the processor is the MC API
 * Gateway's `/proxy/forward-to` endpoint, so every method must: target that endpoint, carry the
 * processor URL from the custom-view environment as the forward-to `uri`, and set
 * `includeUserPermissions` — the processor's manage-permission gate rejects an exchange token without
 * the operator's permission claims. Neither route takes a store: the processor derives it from the
 * resource, so the client sends no store header at all.
 *
 * The application-shell HTTP client is mocked, but the fetcher it is handed is actually invoked
 * against a stubbed `global.fetch`, so the HTTP method, body, response parsing and error propagation
 * are exercised, not just the forward-to config.
 *
 * The client owns no operator-facing wording: a failure the processor did not name itself is raised as
 * a `ProcessorError` carrying an intl id, which the render site formats (spec acceptance 10).
 */

import { renderHook } from '@testing-library/react';
import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import { useCustomViewContext } from '@commercetools-frontend/application-shell-connectors';
import {
  isProcessorError,
  useProcessorClient,
  type ProcessorError,
} from '../../../src/hooks/use-processor-client';
import type { OrderPaymentsDto } from '../../../src/types/payments';
import type { ForwardFetcher } from '../../util/forward-to';

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

const FETCHER_OPTIONS = {
  credentials: 'include' as RequestCredentials,
  headers: { authorization: 'Bearer exchange-token' },
};

/** The forward-to config passed to the most recent `executeHttpClientRequest` call. */
const lastForwardToConfig = () => {
  const call = executeMock.mock.calls[executeMock.mock.calls.length - 1];
  return call[1]?.forwardToConfig;
};

/** The `[url, init]` of the most recent `fetch` call. */
const lastFetchCall = () => {
  const fetchMock = global.fetch as jest.Mock;
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
    string,
    RequestInit
  ];
};

/** Stub `global.fetch` with a Response-like body and drive the fetcher through `executeMock`. */
const stubFetch = (body: unknown, ok = true, status = 200) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => text,
    headers: { get: () => null },
  }) as never;
  executeMock.mockImplementation(
    async (fetcher: ForwardFetcher) => (await fetcher(FETCHER_OPTIONS)).data
  );
};

const orderPayments: OrderPaymentsDto = {
  payments: [
    {
      id: 'payment-1',
      providerPaymentId: '3050000001',
      paymentMethod: 'card',
      merchantReference: 'ref-1',
      inReview: false,
      amountPlanned: { centAmount: 5000, currencyCode: 'EUR' },
      fractionDigits: 2,
      capturableAmount: { centAmount: 5000, currencyCode: 'EUR' },
      refundableAmount: { centAmount: 0, currencyCode: 'EUR' },
      details: { rawStatus: 'PENDING_CAPTURE', operations: [] },
    },
  ],
};

const renderClient = () =>
  renderHook(() => useProcessorClient()).result.current;

/** The `ProcessorError` a call rejected with — asserted as the typed error, not as a string. */
const rejection = async (call: Promise<unknown>): Promise<ProcessorError> => {
  const error = await call.then(
    () => undefined,
    (raised: unknown) => raised
  );
  if (!isProcessorError(error)) {
    throw new Error(`Expected a ProcessorError, got ${String(error)}`);
  }
  return error;
};

describe('useProcessorClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildApiUrl as jest.Mock).mockImplementation(
      (endpoint: string) => `https://mc-api.test${endpoint}`
    );
    useCustomViewContextMock.mockImplementation((selector) =>
      selector({ environment: { processorUrl: PROCESSOR } } as never)
    );
  });

  describe('getOrderPayments', () => {
    it('GETs the order-payments route through the forward-to proxy and parses the view', async () => {
      stubFetch(orderPayments);

      const result = await renderClient().getOrderPayments('order-1');

      expect(result).toEqual(orderPayments);
      const [url, init] = lastFetchCall();
      expect(url).toBe('https://mc-api.test/proxy/forward-to');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(lastForwardToConfig()?.uri).toBe(
        `${PROCESSOR}/operations/orders/order-1/payments`
      );
      expect(lastForwardToConfig()?.headers).toBeUndefined();
      expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    });

    it('propagates the processor error message, which needs no wording of ours', async () => {
      stubFetch({ message: 'Forbidden' }, false, 403);

      const error = await rejection(renderClient().getOrderPayments('order-1'));

      expect(error.message).toBe('Forbidden');
      expect(error.messageId).toBeUndefined();
    });

    it('raises a translatable error when the gateway returns a body that names no reason', async () => {
      stubFetch(undefined, false, 502);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '<html>Bad Gateway</html>',
        headers: { get: () => null },
      }) as never;

      const error = await rejection(renderClient().getOrderPayments('order-1'));

      expect(error.messageId).toBe('PaymentsPanel.processorUnreachable');
      expect(error.values).toEqual({ status: 502 });
    });

    // No response at all (offline, DNS, a rejected `fetch`): the browser's own `Failed to fetch` is
    // English and technical, so this failure needs the panel's words like any other.
    it('raises a translatable error when the request produced no response', async () => {
      stubFetch(undefined);
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch')) as never;

      const error = await rejection(renderClient().getOrderPayments('order-1'));

      expect(error.messageId).toBe('PaymentsPanel.processorOffline');
      expect(error.values).toBeUndefined();
    });
  });

  describe('submitPaymentIntent', () => {
    it('POSTs the action to the payment-intents route with the JSON body', async () => {
      stubFetch({ outcome: 'approved' });

      const result = await renderClient().submitPaymentIntent('payment-1', {
        actions: [
          {
            action: 'capturePayment',
            amount: { centAmount: 5000, currencyCode: 'EUR' },
          },
        ],
      });

      expect(result).toEqual({ outcome: 'approved' });
      const [url, init] = lastFetchCall();
      expect(url).toBe('https://mc-api.test/proxy/forward-to');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(
        JSON.stringify({
          actions: [
            {
              action: 'capturePayment',
              amount: { centAmount: 5000, currencyCode: 'EUR' },
            },
          ],
        })
      );
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
      expect(lastForwardToConfig()?.uri).toBe(
        `${PROCESSOR}/operations/payments/payment-1/intents`
      );
      expect(lastForwardToConfig()?.headers).toBeUndefined();
      expect(lastForwardToConfig()?.includeUserPermissions).toBe(true);
    });

    it('propagates the processor error message of a rejected action', async () => {
      stubFetch(
        { message: 'Amount exceeds the remaining balance' },
        false,
        400
      );

      const error = await rejection(
        renderClient().submitPaymentIntent('payment-1', {
          actions: [
            {
              action: 'refundPayment',
              amount: { centAmount: 9999, currencyCode: 'EUR' },
            },
          ],
        })
      );

      expect(error.message).toBe('Amount exceeds the remaining balance');
      expect(error.messageId).toBeUndefined();
    });

    // The reservation lost the version race: the payment moved before the operation was reserved, so
    // NOTHING reached the vendor. The processor names it in English; the panel must say it in the
    // operator's language and offer the re-read, so the id wins over the body's message here.
    it('raises the concurrent-modification id on a 409, over the message the processor sent', async () => {
      stubFetch(
        {
          message: 'The payment changed while the operation was reserved.',
          statusCode: 409,
          errors: [{ code: 'ConcurrentModification' }],
        },
        false,
        409
      );

      const error = await rejection(
        renderClient().submitPaymentIntent('payment-1', {
          actions: [{ action: 'cancelPayment' }],
        })
      );

      expect(error.messageId).toBe('PaymentsPanel.concurrentModification');
      expect(error.values).toBeUndefined();
    });

    // The status alone does NOT say the operation never left: a vendor conflict — the vendor already holds
    // an operation under this name, so the money may be gone — can reach the panel as a 409 too, and the
    // processor leaves its leg STANDING for exactly that reason. Wording it as the benign version race would
    // invite the retry the processor refused to make. Only the processor's own `ConcurrentModification` is
    // the one that reached nothing.
    it('leaves a 409 the processor did NOT call a version conflict in the processor’s own words', async () => {
      stubFetch(
        {
          message: 'PSP API error (409): the operation is already in progress',
          statusCode: 409,
          errors: [{ code: 'ProviderRefusedOperation' }],
        },
        false,
        409
      );

      const error = await rejection(
        renderClient().submitPaymentIntent('payment-1', {
          actions: [{ action: 'cancelPayment' }],
        })
      );

      expect(error.messageId).toBeUndefined();
      expect(error.message).toBe(
        'PSP API error (409): the operation is already in progress'
      );
    });
  });
});
