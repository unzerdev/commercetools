/** `POST /v1/webhooks` with an `eventList`; Unzer creates one subscription per name, so the answer is a list of ids. */
export interface RegisterWebhooksRequest {
  url: string;
  events: readonly string[];
}

/** `GET /v1/webhooks`, optionally narrowed to the subscriptions pointing at one URL. */
export interface ListWebhooksRequest {
  url?: string;
}

/** `DELETE /v1/webhooks`: by `ids` one at a time, or the account-wide delete when none are known. */
export interface DeleteWebhooksRequest {
  ids?: string[];
}
