/** The path portion of a resource url; `''` for a url with none. A leading slash is guaranteed when non-empty. */
function resourcePath(resourceUrl: string | undefined): string {
  if (!resourceUrl) {
    return '';
  }
  const withoutSuffix = resourceUrl.split('?')[0].split('#')[0];
  const authorityAt = withoutSuffix.startsWith('//') ? 0 : withoutSuffix.indexOf('://');
  if (authorityAt < 0) {
    return withoutSuffix.startsWith('/') ? withoutSuffix : `/${withoutSuffix}`;
  }
  const authorityStart = authorityAt === 0 ? 2 : authorityAt + 3;
  const pathAt = withoutSuffix.indexOf('/', authorityStart);
  return pathAt < 0 ? '' : withoutSuffix.slice(pathAt);
}

/** The resource's own id: the trailing path segment. `''` when the url names no resource. */
export function resourceId(resourceUrl: string | undefined): string {
  const segments = resourcePath(resourceUrl).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * Whether a cancellation leg reversed an authorization (a void) rather than a charge (a refund). Unzer
 * embeds the parent kind in the path (`/authorize/.../cancels`); anything else reads as a refund, the
 * fail-closed direction.
 */
export function reversesAuthorization(resourceUrl: string | undefined): boolean {
  return /\/authorize\//.test(resourcePath(resourceUrl));
}

/**
 * The charge a cancellation leg drew on (`.../charges/{chargeId}/cancels/{cancelId}` gives `{chargeId}`).
 * `''` when the url names no charge parent: a void, or a payment-level cancellation.
 */
export function parentChargeId(resourceUrl: string | undefined): string {
  const segments = resourcePath(resourceUrl).split('/').filter(Boolean);
  const chargesAt = segments.indexOf('charges');
  return chargesAt >= 0 && segments.length > chargesAt + 2 ? segments[chargesAt + 1] : '';
}

/**
 * One identity from a parent id and an own id. Unzer numbers a cancellation within its parent charge, so
 * two refunds of one payment share a trailing segment; the pair keeps them apart. The joiner is `.`
 * because the composite reaches a commercetools Custom Object key whose charset excludes `:` and `/`.
 */
export function composeOperationIdentity(parentId: string, ownId: string): string {
  return parentId === '' || ownId === '' ? ownId : `${parentId}.${ownId}`;
}

/**
 * The identity of one vendor operation on a payment, read out of its url: the value the connector records
 * as the CT Transaction `interactionId`, dedups redeliveries on and builds the webhook marker key from.
 */
export function operationIdentity(resourceUrl: string | undefined): string {
  return composeOperationIdentity(parentChargeId(resourceUrl), resourceId(resourceUrl));
}
