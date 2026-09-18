/** The fields this connector reads off a delivered notification; every one is optional to Unzer. */
export interface UnzerWebhookEnvelope {
  event?: string;
  paymentId?: string;
  retrieveUrl?: string;
}

/**
 * Read the delivered bytes as the envelope. A body that is not a JSON object yields an empty envelope, which
 * the handler answers as ignorable noise: a 5xx would put the vendor into indefinite redelivery of bytes that
 * can never parse.
 */
export function parseEnvelope(rawBody: Buffer): UnzerWebhookEnvelope {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as UnzerWebhookEnvelope) : {};
  } catch {
    return {};
  }
}
