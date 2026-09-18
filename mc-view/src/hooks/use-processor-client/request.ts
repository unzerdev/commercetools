/**
 * Pure request-construction helpers for the processor client. Kept side-effect-free so the URL wiring
 * can be unit-tested without mocking the application-shell HTTP client.
 *
 * Neither route takes a store: the processor derives it from the resource it is asked about (the
 * order's store for the read, the payment's `storeKey` custom field for an action), so the
 * view names no store and sends no store header.
 */

/**
 * Build a processor operation URL: `<externalApiUrl>/operations/<endpoint>`.
 *
 * A blank base is a caller that ran before the processor URL was resolved. It throws rather than
 * building a relative `/operations/...`, which the gateway would forward to itself.
 */
const operationUri = (externalApiUrl: string, endpoint: string): string => {
  if (externalApiUrl.trim() === '') {
    throw new Error(
      'The processor URL is not configured: deploy the processor, then set PROCESSOR_URL to the URL Connect assigned it and deploy this application again.'
    );
  }
  return `${externalApiUrl}/operations/${endpoint}`;
};

/**
 * The order's payment panel, read in one call. The id is escaped: it is lifted from the Merchant
 * Center host URL, so it must never be able to reshape the path it lands in.
 */
export const orderPaymentsUri = (
  externalApiUrl: string,
  orderId: string
): string =>
  operationUri(
    externalApiUrl,
    `orders/${encodeURIComponent(orderId)}/payments`
  );

/** The merchant-initiated capture/refund/cancel route of a single payment. */
export const paymentIntentsUri = (
  externalApiUrl: string,
  paymentId: string
): string =>
  operationUri(
    externalApiUrl,
    `payments/${encodeURIComponent(paymentId)}/intents`
  );
