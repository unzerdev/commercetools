import type { ModificationAction } from './modification-action';

/** A payment-intent request: at most one action per call. */
export interface ModificationRequest {
  actions: ModificationAction[];
}
