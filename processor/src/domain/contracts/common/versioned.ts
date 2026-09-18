/** A commercetools document read together with its version; `null` value when it does not exist yet. */
export interface Versioned<T> {
  value: T | null;
  version: number | undefined;
}
