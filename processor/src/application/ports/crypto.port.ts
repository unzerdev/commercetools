/** The one crypto operation the application needs: the webhook capability-URL token gate. */
export interface Crypto {
  /** Constant-time, fail-closed and total: an invalid candidate or an unconfigured key answers `false`. */
  verifyWebhookUrlToken(storeKey: string, candidate: string): boolean;
}
