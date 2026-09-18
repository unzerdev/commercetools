import type { Money } from '../common';
import type { ProviderStatusInput } from './provider-status-input';

/** One modification the provider holds against the payment; reconciliation matches standing legs by `id`. */
export interface ProviderOperation {
  /** Absent when the provider reports an operation it does not name. */
  id?: string;
  /** Display kind, or the vendor's own kind when unrecognised. */
  type?: string;
  /** ISO timestamp. */
  date?: string;
  outcome?: 'success' | 'pending' | 'error';
  amount?: Money;
  rawStatus: ProviderStatusInput;
}
