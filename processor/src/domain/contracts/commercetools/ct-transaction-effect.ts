import type { CtTransactionState } from './ct-transaction-state';
import type { CtTransactionType } from './ct-transaction-type';

/** The commercetools Transaction a payment state resolves to. */
export interface CtTransactionEffect {
  type: CtTransactionType;
  state: CtTransactionState;
}
