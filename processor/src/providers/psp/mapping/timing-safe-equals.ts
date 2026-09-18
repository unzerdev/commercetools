import crypto from 'node:crypto';

/** Length-guarded constant-time comparison; `false` on any mismatch including an absent value, so callers fail closed. */
export function timingSafeEquals(expected: string, provided: string | undefined): boolean {
  if (!provided) {
    return false;
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
