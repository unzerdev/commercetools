/**
 * Whether a 2xx body carries a vendor refusal: a non-empty `errors` array or an explicit `isError: true`.
 * `isError: false` and an empty `errors` state the absence of one and never refuse.
 */
export function isRefusal(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') {
    return false;
  }
  const body = raw as { errors?: unknown; isError?: unknown };
  return (Array.isArray(body.errors) && body.errors.length > 0) || body.isError === true;
}
