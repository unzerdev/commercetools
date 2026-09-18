import { useMemo } from 'react';
import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import type {
  OrderPaymentsDto,
  PaymentIntentRequestDto,
  PaymentIntentResponseDto,
} from '../../types/payments';
import { useProcessorUrl } from '../use-processor-url';
import { ProcessorError } from './processor-error';
import { orderPaymentsUri, paymentIntentsUri } from './request';

/**
 * The Custom View's only channel to the processor. Every method forwards through the MC API Gateway
 * `/proxy/forward-to` endpoint: the gateway mints a short-lived JWT exchange token (audience = the
 * processor URL) and forwards the request server-side, which the processor's `JWTAuthenticationHook`
 * validates. The view never calls the processor — or commercetools, or the vendor — directly.
 *
 * The client is intentionally thin — no business logic, no caching (the query cache owns that) and no
 * store: both routes derive the store from the resource they name. It owns no wording
 * either: a failure the processor did not name itself is raised as a `ProcessorError` carrying an intl
 * id, which the render site formats through the panel's catalogue.
 */

type ForwardMethod = 'GET' | 'POST';

/** The pre-configured options the application-shell HTTP client hands the fetcher (credentials + the
 * gateway/forward headers it has already assembled). Typed structurally so `options` is never `any`. */
type ForwardHttpClientOptions = {
  credentials: RequestCredentials;
  headers: Record<string, string>;
};

export type ProcessorClient = {
  getOrderPayments: (orderId: string) => Promise<OrderPaymentsDto>;
  submitPaymentIntent: (
    paymentId: string,
    body: PaymentIntentRequestDto
  ) => Promise<PaymentIntentResponseDto>;
};

/**
 * The processor's own code for the LOST VERSION RACE — the payment moved before the operation could be
 * reserved, so nothing reached the vendor. The STATUS alone cannot say that: a vendor conflict answers
 * 409 as well, and it means the opposite (the vendor already holds an operation under this name — money
 * that may be gone), which is why the processor deliberately leaves its leg standing. Only the code
 * separates them.
 */
const isVersionConflict = (body: unknown): boolean => {
  const errors = (body as { errors?: unknown })?.errors;
  return (
    Array.isArray(errors) &&
    (errors[0] as { code?: unknown } | undefined)?.code ===
      'ConcurrentModification'
  );
};

/**
 * The failure of one call. The processor's own message — human-readable and secret-free — is what the
 * operator reads where the body carries one; where it does not (a gateway 502 with an HTML body), the
 * error names the panel's message id instead, and the render site translates it. The `Error.message`
 * of an id-carrying case is a diagnostic, never rendered.
 *
 * The version conflict is taken BEFORE the body's message, though it carries one: it is the one failure
 * that reached nothing, so it is an answer with an affordance (re-read the panel) — which only the panel
 * can word and offer. Every other failure keeps the processor's own words, because only it knows whether
 * the money moved.
 */
const errorFrom = (body: unknown, statusCode: number): ProcessorError => {
  if (statusCode === 409 && isVersionConflict(body)) {
    return new ProcessorError(
      'The payment changed before the operation could be reserved.',
      'PaymentsPanel.concurrentModification'
    );
  }
  if (body && typeof body === 'object') {
    const candidate = body as { message?: unknown; error?: unknown };
    if (typeof candidate.message === 'string')
      return new ProcessorError(candidate.message);
    if (typeof candidate.error === 'string')
      return new ProcessorError(candidate.error);
  }
  return new ProcessorError(
    `The processor request failed with HTTP ${statusCode} and named no reason.`,
    'PaymentsPanel.processorUnreachable',
    { status: statusCode }
  );
};

const forwardRequest = <Data>(params: {
  uri: string;
  method: ForwardMethod;
  body?: unknown;
}): Promise<Data> =>
  executeHttpClientRequest<Data>(
    async (options: ForwardHttpClientOptions) => {
      const hasBody = params.body !== undefined;
      const request = fetch(buildApiUrl('/proxy/forward-to'), {
        ...options,
        method: params.method,
        headers: hasBody
          ? { ...options.headers, 'Content-Type': 'application/json' }
          : options.headers,
        ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
      });

      // A rejected `fetch` produced no response at all (offline, DNS): it carries the browser's own
      // English `Failed to fetch`, which is neither translatable nor an answer — so it becomes the
      // panel's offline message like any other failure the processor did not name.
      const response = await request.catch(() => {
        throw new ProcessorError(
          'The processor request produced no response.',
          'PaymentsPanel.processorOffline'
        );
      });

      // Parse defensively: a gateway/error path can return a non-JSON body (HTML 502) BEFORE the
      // `ok` check, so a raw `JSON.parse` would throw a `SyntaxError` past `errorFrom` instead of the
      // translatable fallback. An unparseable body becomes `undefined`.
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }

      if (!response.ok) {
        throw errorFrom(parsed, response.status);
      }

      return {
        data: parsed as Data,
        statusCode: response.status,
        getHeader: (name: string) => response.headers.get(name),
      };
    },
    {
      forwardToConfig: {
        uri: params.uri,
        // Carry the operator's MC permissions (`<iss>/claims/user_permissions`) on the exchange token
        // so the processor can enforce its manage-permission gate on both panel routes.
        includeUserPermissions: true,
      },
    }
  );

/**
 * The processor origin this view talks to. The client below reaches the processor through the MC
 * gateway, but the panel also links to it DIRECTLY for one thing — the public method-logo assets —
 * and that link is an ordinary browser image request, not a forward-to.
 *
 * `undefined` while the published descriptor is still being read, and when none exists: callers
 * already treat that as "no logo", so a slow read degrades to a missing image, never a broken one.
 */
export const useExternalApiUrl = (): string | undefined =>
  useProcessorUrl().url;

export const useProcessorClient = (): ProcessorClient => {
  // Empty while the published descriptor is still being read; `orderPaymentsUri` then throws rather
  // than sending a call to a half-built URL, and the panel renders that as its unreachable state.
  const externalApiUrl = useProcessorUrl().url ?? '';

  return useMemo<ProcessorClient>(
    () => ({
      getOrderPayments: (orderId) =>
        forwardRequest<OrderPaymentsDto>({
          uri: orderPaymentsUri(externalApiUrl, orderId),
          method: 'GET',
        }),

      submitPaymentIntent: (paymentId, body) =>
        forwardRequest<PaymentIntentResponseDto>({
          uri: paymentIntentsUri(externalApiUrl, paymentId),
          method: 'POST',
          body,
        }),
    }),
    [externalApiUrl]
  );
};
