import { PspError } from '../../errors';
import { expectObject } from './keypair';

/** One subscription as the connector records it. */
export interface WebhookEntry {
  id: string;
  url?: string;
  event?: string;
}

/**
 * Flatten either response shape (one object, or `events[]` for an `eventList` registration) into entries,
 * dropping anything unnamed. A non-object body or a non-list `events` is drift and fails as a typed 502.
 */
export function parseWebhookEntries(raw: unknown): WebhookEntry[] {
  const body = expectObject(raw, 'webhooks');

  if (body.events !== undefined && !Array.isArray(body.events)) {
    throw PspError.malformedResponse('webhooks: events is not a list of subscriptions');
  }

  const entries = (body.events as unknown[] | undefined) ?? (typeof body.id === 'string' ? [body] : []);

  return entries
    .map((entry) => expectObject(entry, 'webhooks.events[]'))
    .filter(
      (entry): entry is { id: string; url?: string; event?: string } => typeof entry.id === 'string' && entry.id !== '',
    )
    .map((entry) => ({
      id: entry.id,
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(typeof entry.event === 'string' ? { event: entry.event } : {}),
    }));
}
