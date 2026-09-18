import type { CtTransactionEffect } from './ct-transaction-effect';

/** What a payment state means for commercetools: nothing yet, or a Transaction (plus the review flag for `IN_REVIEW`). */
export type StateEffect =
  { kind: 'no-op' } | { kind: 'transaction'; transaction: CtTransactionEffect; reviewField?: boolean };
