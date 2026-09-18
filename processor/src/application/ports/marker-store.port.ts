/** The webhook idempotency marker: a Custom Object whose existence is the claim. */
export interface MarkerStore {
  /** Create-if-absent; `false` when it already existed or a concurrent create won. */
  claim(key: string): Promise<boolean>;

  /** Best-effort delete so a redelivery can re-process. */
  release(key: string): Promise<void>;
}
