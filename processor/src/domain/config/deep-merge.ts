/** `true` for a non-null, non-array object. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keys never merged: the layers are JSON-sourced, so `__proto__` can arrive as an own key. */
const FORBIDDEN_MERGE_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Deep-merge `override` onto `base`: plain objects recurse, arrays and scalars are replaced, `undefined` yields the other side. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) {
    return base;
  }
  if (base === undefined) {
    return override;
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      if (FORBIDDEN_MERGE_KEYS.includes(key)) {
        continue;
      }
      result[key] = deepMerge(base[key], override[key]);
    }
    return result;
  }
  return override;
}
