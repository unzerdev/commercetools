import type { CreatePaymentDraft } from './create-payment-draft';
import type { HasTransactionInStateArgs } from './has-transaction-in-state-args';
import type { Payment } from './payment';
import type { PaymentStatusUpdate } from './payment-status-update';
import type { ReservedLeg } from './reserved-leg';
import type { ReserveTransactionArgs } from './reserve-transaction-args';
import type { TransactionSettlement } from './transaction-settlement';
import type { UpdatePaymentArgs } from './update-payment-args';

/** The commercetools Payment read/write view, including the write-ahead reservation the money path spends through. */
export interface PaymentStore {
  create(draft: CreatePaymentDraft): Promise<Payment>;

  /** Writes the vendor status code, text and the payment state in one post; nothing to say writes nothing. */
  setStatus(id: string, status: PaymentStatusUpdate): Promise<void>;

  update(args: UpdatePaymentArgs): Promise<Payment>;

  get(id: string): Promise<Payment>;

  /** The reconciliation lookup, scoped to `storeKey` when given. */
  findByMerchantReference(merchantReference: string, storeKey?: string): Promise<Payment | undefined>;

  /** A missing payment is an answer, not a throw; the caller re-imposes the store guard. */
  findById(id: string): Promise<Payment | undefined>;

  /** Merges the review flag via `setCustomField`, never a `setCustomType` replace. */
  setReviewFlag(id: string): Promise<void>;

  /** Writes the operation's `Pending` leg under the caller's version; a conflict fails, never retries. */
  reserve(args: ReserveTransactionArgs): Promise<void>;

  /** Closes a reserved leg with the vendor's answer and stamps the vendor operation id onto it. */
  settle(paymentId: string, leg: ReservedLeg, settlement: TransactionSettlement): Promise<void>;

  /** Moves a reserved leg to `Failure`: the vendor refused, the headroom comes back. */
  release(paymentId: string, leg: ReservedLeg): Promise<void>;

  hasTransactionInState(args: HasTransactionInStateArgs): boolean;
}
