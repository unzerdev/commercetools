/**
 * The transport: one request through the MC API Gateway's `/proxy/forward-to`, and the typing of what
 * comes back. The gateway mints a short-lived JWT (audience = the processor URL) and forwards the call
 * server-side, so the app never reaches the processor directly.
 */

import {
  buildApiUrl,
  executeHttpClientRequest,
} from '@commercetools-frontend/application-shell';
import { ProcessorError } from './processor-error';
import { storeKeyForwardHeaders } from './request';

export type ForwardMethod = 'GET' | 'PUT' | 'DELETE';

/** What the application-shell HTTP client hands the fetcher: credentials + the headers it assembled. */
type ForwardHttpClientOptions = {
  credentials: RequestCredentials;
  headers: Record<string, string>;
};

/**
 * The processor's own message is what the operator reads. Where the body carries none - a gateway 502
 * with an HTML body - the error names an intl id instead and the render site translates it; its
 * `Error.message` is then a diagnostic, never rendered.
 */
const errorFrom = (body: unknown, statusCode: number): ProcessorError => {
  if (body && typeof body === 'object') {
    const candidate = body as { message?: unknown; error?: unknown };
    if (typeof candidate.message === 'string')
      return new ProcessorError(candidate.message);
    if (typeof candidate.error === 'string')
      return new ProcessorError(candidate.error);
  }
  return new ProcessorError(
    `The processor request failed with HTTP ${statusCode} and named no reason.`,
    'ConfigApp.processorUnreachable',
    { status: statusCode }
  );
};

/** Send one forwarded request and return its parsed body as `Data`. */
export const forwardRequest = <Data>(params: {
  uri: string;
  method: ForwardMethod;
  storeKey: string | undefined;
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

      // A rejected `fetch` produced no response at all (offline, DNS). Its `Failed to fetch` is the
      // browser's own English, so it becomes the app's translatable offline message instead.
      const response = await request.catch(() => {
        throw new ProcessorError(
          'The processor request produced no response.',
          'ConfigApp.processorOffline'
        );
      });

      // Parsed defensively: an error path can answer with a non-JSON body (an HTML 502) BEFORE the `ok`
      // check, and a raw `JSON.parse` would throw past `errorFrom` instead of the translatable fallback.
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
        headers: storeKeyForwardHeaders(params.storeKey),
        // Carry the operator's MC permissions on the exchange token, so the processor can enforce its
        // manage-permission gate on the privileged config mutations.
        includeUserPermissions: true,
      },
    }
  );
