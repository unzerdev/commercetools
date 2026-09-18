import { isConcurrentModification } from './errors';

const CAS_MAX_ATTEMPTS = 3;

/**
 * Re-read and re-post when a concurrent write bumps the version, up to three attempts. For writes that
 * record an outcome already decided; a reservation must fail on conflict and never goes through here.
 */
export async function withVersionRetry<T>(read: () => Promise<T>, write: (current: T) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const current = await read();
    try {
      await write(current);
      return;
    } catch (error) {
      if (isConcurrentModification(error) && attempt < CAS_MAX_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
}
