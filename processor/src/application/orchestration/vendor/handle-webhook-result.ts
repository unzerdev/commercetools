/** `unauthorized` answers 401, the rest 200; a genuine processing failure throws and answers 5xx. */
export interface HandleWebhookResult {
  outcome: 'processed' | 'duplicate' | 'ignored' | 'unauthorized';
}
