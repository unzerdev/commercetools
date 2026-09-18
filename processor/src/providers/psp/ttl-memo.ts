/** A per-key memo with a fixed lifetime; only what the caller stores is kept, so a failure caches nothing. */
export class TtlMemo<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The live value under `key`, or `undefined` when absent or expired. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > this.now() ? entry.value : undefined;
  }

  /** Store `value` under `key` for one lifetime. */
  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
