/** Replace the token segment of every `/webhooks/<store>/<token>` occurrence (plain or JSON-escaped) with `<redacted>`. */
export const redactWebhookToken = (text: string): string =>
  text.replace(/((?:\\?\/)webhooks(?:\\?\/)[^/?#\s]*(?:\\?\/))[A-Za-z0-9_-]+/gi, '$1<redacted>');

const MAX_REDACT_DEPTH = 8;

/**
 * A log-safe deep copy: every reachable string (keys included) is token-redacted, errors become plain
 * objects so their message and stack survive, functions are dropped, cycles and excess depth are cut.
 */
export function redactErrorForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return redactWebhookToken(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_REDACT_DEPTH) {
    return '[Truncated]';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.map((item) => redactErrorForLog(item, depth + 1, seen));
    seen.delete(value);
    return items;
  }

  const source: Record<string, unknown> =
    value instanceof Error
      ? { ...value, name: value.name, message: value.message, stack: value.stack }
      : (value as Record<string, unknown>);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'function') {
      continue;
    }
    out[redactWebhookToken(key)] = redactErrorForLog(item, depth + 1, seen);
  }
  seen.delete(value);
  return out;
}
