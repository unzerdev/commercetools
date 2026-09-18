/**
 * Pure request-construction helpers for the processor client. Kept side-effect-free so the URL, query,
 * and forward-header wiring can be unit-tested without mocking the application-shell HTTP client.
 */

/** Custom forward header carrying the selected store to the processor as `X-Store-Key`. The
 * application-shell's forward-to plumbing (`getAppliedForwardToHeaders`) prefixes every custom header
 * with `x-forward-header-`, which the MC API Gateway then strips — so this is the bare `x-store-key`,
 * NOT the prefixed form (prefixing it here would reach the processor as `X-Forward-Header-X-Store-Key`). */
export const STORE_KEY_FORWARD_HEADER = 'x-store-key';

/**
 * Build a processor operation URL: `<externalApiUrl>/operations/<endpoint>`.
 *
 * A blank base is a caller that ran before the processor URL was resolved. It throws rather than
 * building a relative `/operations/...`, which the gateway would forward to itself.
 */
export const operationUri = (
  externalApiUrl: string,
  endpoint: string
): string => {
  if (externalApiUrl.trim() === '') {
    throw new Error(
      'The processor URL is not configured: deploy the processor, then set PROCESSOR_URL to the URL Connect assigned it and deploy this application again.'
    );
  }
  return `${externalApiUrl}/operations/${endpoint}`;
};

/**
 * The forward header carrying the selected store key. Empty when no store is in scope: the connector-wide
 * reads (the store list, `getStores`) deliberately omit it. Store-config WRITES always carry it — the
 * config screen only mounts its form once a store is selected, and the processor rejects any store-config
 * write whose target resolves to the reserved project key — so a store-less write can never reach a
 * money-path config.
 */
export const storeKeyForwardHeaders = (
  storeKey: string | undefined
): Record<string, string> =>
  storeKey ? { [STORE_KEY_FORWARD_HEADER]: storeKey } : {};
