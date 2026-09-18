import { PspError } from '../errors';
import type { PspConnectionConfig } from './connection';
import { isRefusal } from './responses/errors';

/** One vendor call, named rather than positional. */
export interface PspRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path under the selected host, already encoded. */
  path: string;
  body?: unknown;
  /** The operation's stable name, sent as `Idempotency-Key`; absent on naturally idempotent calls. */
  idempotencyKey?: string;
}

/** What a resource needs from the transport: the seam a test replaces without stubbing `fetch`. */
export interface PspTransport {
  send(cfg: PspConnectionConfig, request: PspRequest): Promise<unknown>;
}

const baseUrl = (cfg: PspConnectionConfig): string => (cfg.mode === 'live' ? cfg.hosts.live : cfg.hosts.sandbox);

/** HTTP Basic with the private key as the username and an empty password; the key lives only in this header. */
const authorization = (cfg: PspConnectionConfig): string =>
  `Basic ${Buffer.from(`${cfg.credentials.privateKey}:`).toString('base64')}`;

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Opt-in request trace (`PSP_TRACE_VENDOR_CALLS=1`): method, path and body only, for the vendor validation
 * errors that name no field. The credential travels in a header this never reads; card data never reaches
 * this transport. `console` because the provider ring imports no infrastructure logger.
 */
function traceRequest({ method, path, body }: PspRequest): void {
  if (process.env.PSP_TRACE_VENDOR_CALLS !== '1') {
    return;
  }
  // eslint-disable-next-line no-console -- an opt-in terminal trace, see the doc block above.
  console.info(`[psp] ${method} ${path} ${body === undefined ? '(no body)' : JSON.stringify(body)}`);
}

/**
 * The one place the connector performs an Unzer HTTP call: host by `mode`, Basic auth, a hard deadline that
 * raises the ambiguous 504, every non-2xx and every 2xx carrying a refusal as a typed `PspError`.
 */
export class HttpPspTransport implements PspTransport {
  public async send(cfg: PspConnectionConfig, request: PspRequest): Promise<unknown> {
    const { method, path, body, idempotencyKey } = request;
    traceRequest(request);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, cfg.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${baseUrl(cfg)}${path}`, {
        method,
        headers: {
          Authorization: authorization(cfg),
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (cause) {
      throw timedOut ? PspError.timedOut(cfg.requestTimeoutMs) : PspError.fromTransport(cause);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw PspError.fromErrorResponse(response.status, await parseJson(response));
    }

    const parsed = await parseJson(response);
    if (isRefusal(parsed)) {
      throw PspError.fromErrorResponse(response.status, parsed);
    }
    return parsed;
  }
}
