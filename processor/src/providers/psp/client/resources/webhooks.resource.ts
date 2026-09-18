import { PspError } from '../../errors';
import type { PspConnectionConfig } from '../connection';
import type { PspTransport } from '../transport';
import type { DeleteWebhooksRequest, ListWebhooksRequest, RegisterWebhooksRequest } from '../requests/webhooks';
import { parseWebhookEntries, type WebhookEntry } from '../responses/webhooks';

/** Unzer's refusal when the account already subscribes one of these events to this URL. */
const WEBHOOK_ALREADY_EXISTS_CODE = 'API.510.310.009';

const isAlreadySubscribed = (error: unknown): boolean =>
  error instanceof PspError && error.hasVendorCode(WEBHOOK_ALREADY_EXISTS_CODE);

/** The webhooks resource surface a test can stand in for. */
export interface WebhooksApi {
  register(cfg: PspConnectionConfig, request: RegisterWebhooksRequest): Promise<string[]>;
  list(cfg: PspConnectionConfig, request?: ListWebhooksRequest): Promise<WebhookEntry[]>;
  delete(cfg: PspConnectionConfig, request?: DeleteWebhooksRequest): Promise<void>;
}

export class WebhooksResource implements WebhooksApi {
  constructor(private readonly transport: PspTransport) {}

  /**
   * `POST /v1/webhooks` with the `eventList`; one subscription per name, all at the same URL. An account
   * already subscribed adopts the existing ids instead of failing a connect with nothing wrong.
   */
  public async register(cfg: PspConnectionConfig, request: RegisterWebhooksRequest): Promise<string[]> {
    const body = { url: request.url, eventList: [...request.events] };
    try {
      const answer = await this.transport.send(cfg, { method: 'POST', path: '/v1/webhooks', body });
      return parseWebhookEntries(answer).map((entry) => entry.id);
    } catch (error) {
      if (!isAlreadySubscribed(error)) {
        throw error;
      }
      return (await this.listSafely(cfg, { url: request.url })).map((entry) => entry.id);
    }
  }

  /** `GET /v1/webhooks`, optionally narrowed to one URL. */
  public async list(cfg: PspConnectionConfig, request: ListWebhooksRequest = {}): Promise<WebhookEntry[]> {
    const entries = parseWebhookEntries(await this.transport.send(cfg, { method: 'GET', path: '/v1/webhooks' }));
    return request.url === undefined ? entries : entries.filter((entry) => entry.url === request.url);
  }

  /** By `ids` one at a time; without them the account-wide `DELETE /v1/webhooks`, which takes every subscription. */
  public async delete(cfg: PspConnectionConfig, request: DeleteWebhooksRequest = {}): Promise<void> {
    const ids = request.ids ?? [];
    if (ids.length > 0) {
      for (const id of ids) {
        await this.transport.send(cfg, { method: 'DELETE', path: `/v1/webhooks/${encodeURIComponent(id)}` });
      }
      return;
    }
    await this.transport.send(cfg, { method: 'DELETE', path: '/v1/webhooks' });
  }

  /** The list, best-effort: an unreadable list leaves no ids to target later and never fails the connect. */
  private async listSafely(cfg: PspConnectionConfig, request: ListWebhooksRequest): Promise<WebhookEntry[]> {
    try {
      return await this.list(cfg, request);
    } catch {
      return [];
    }
  }
}
