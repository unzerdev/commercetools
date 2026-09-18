import type { CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';
import type {
  CreatePaymentDraft,
  HasTransactionInStateArgs,
  Payment,
  PaymentStatusUpdate,
  PaymentStore,
  ReservedLeg,
  ReserveTransactionArgs,
  TransactionSettlement,
  UpdatePaymentArgs,
} from '../../application/ports';
import {
  findPaymentById,
  findPaymentByMerchantReference,
  releaseTransaction,
  reserveTransaction,
  setPaymentReviewFlag,
  setPaymentStatus,
  settleTransaction,
} from '../commercetools/payments.repository';

/** `PaymentStore`: the SDK service for what it offers, the raw repository for what it does not. */
export class PaymentStoreAdapter implements PaymentStore {
  constructor(private readonly ctPaymentService: CommercetoolsPaymentService) {}

  public create(draft: CreatePaymentDraft): Promise<Payment> {
    return this.ctPaymentService.createPayment(draft);
  }

  public update(args: UpdatePaymentArgs): Promise<Payment> {
    return this.ctPaymentService.updatePayment(args);
  }

  public setStatus(id: string, status: PaymentStatusUpdate): Promise<void> {
    return setPaymentStatus(id, status);
  }

  public get(id: string): Promise<Payment> {
    return this.ctPaymentService.getPayment({ id });
  }

  public findByMerchantReference(merchantReference: string, storeKey?: string): Promise<Payment | undefined> {
    return findPaymentByMerchantReference(merchantReference, storeKey);
  }

  public findById(id: string): Promise<Payment | undefined> {
    return findPaymentById(id);
  }

  public setReviewFlag(id: string): Promise<void> {
    return setPaymentReviewFlag(id);
  }

  public reserve(args: ReserveTransactionArgs): Promise<void> {
    return reserveTransaction(args);
  }

  public settle(paymentId: string, leg: ReservedLeg, settlement: TransactionSettlement): Promise<void> {
    return settleTransaction(paymentId, leg, settlement);
  }

  public release(paymentId: string, leg: ReservedLeg): Promise<void> {
    return releaseTransaction(paymentId, leg);
  }

  public hasTransactionInState(args: HasTransactionInStateArgs): boolean {
    return this.ctPaymentService.hasTransactionInState(args);
  }
}
