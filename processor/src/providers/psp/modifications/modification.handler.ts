import type { ModificationHandler } from '../../../application/handlers';
import {
  type CancelRequest,
  type CaptureRequest,
  type OperationResult,
  PaymentState,
  type ProviderStatusCode,
  type RefundPlanRequest,
  type RefundPlanSlice,
  type RefundRequest,
  type StoreConfig,
} from '../../../domain';
import { PspClient, toPspConnectionConfig } from '../client';
import type { UnzerModification } from '../client';
import { PspError } from '../errors';
import { toStatusCode } from '../mapping';
import { composeOperationIdentity, toRawStatus } from '../status';
import { cancelsByOrderReference, refundsViaPayment } from './method-routing';
import { allocateRefund } from './refund-allocation';

/** The states one modification resolves to, by what the vendor said about it. */
interface ModificationVerdicts {
  settled: PaymentState;
  requested: PaymentState;
}

/**
 * One rule for all three: `isError` is a refusal (FAILED), `isSuccess` and only that is the operation
 * performed, anything else is an acknowledgement its own webhook settles. Reading an unstated verdict as
 * success would report money moved that the vendor still holds.
 */
function modificationStatus(modification: UnzerModification, verdicts: ModificationVerdicts): PaymentState {
  if (modification.isError) {
    return PaymentState.FAILED;
  }
  return modification.isSuccess ? verdicts.settled : verdicts.requested;
}

function statusCodeOf(modification: UnzerModification): { statusCode?: ProviderStatusCode } {
  const statusCode = toStatusCode(modification.message);
  return statusCode ? { statusCode } : {};
}

/**
 * Capture, cancel and refund of an existing Unzer payment. Each carries the core's `operationReference` as the
 * idempotency key; the modification's own id becomes the operation id the settling webhook matches.
 */
export class PspModificationHandler implements ModificationHandler {
  constructor(private readonly unzer: Pick<PspClient, 'payments'> = new PspClient()) {}

  async capture(cfg: StoreConfig, req: CaptureRequest): Promise<OperationResult> {
    const modification = await this.unzer.payments.capture(toPspConnectionConfig(cfg), {
      paymentId: req.providerPaymentId,
      amountCents: req.amount,
      fractionDigits: req.fractionDigits,
      operationReference: req.operationReference,
    });
    return {
      providerOperationId: modification.id,
      rawStatus: toRawStatus(
        modificationStatus(modification, { settled: PaymentState.CAPTURED, requested: PaymentState.CAPTURE_REQUESTED }),
      ),
      ...statusCodeOf(modification),
    };
  }

  /** The paylater family is addressed by the merchant order reference, as the reference integration does. */
  async cancel(cfg: StoreConfig, req: CancelRequest): Promise<OperationResult> {
    const modification = await this.unzer.payments.cancelAuthorization(toPspConnectionConfig(cfg), {
      paymentId:
        cancelsByOrderReference(req.paymentMethod) && req.merchantOrderId ? req.merchantOrderId : req.providerPaymentId,
      ...(req.amount ? { amountCents: req.amount.centAmount } : {}),
      fractionDigits: req.fractionDigits,
      operationReference: req.operationReference,
    });
    return {
      providerOperationId: modification.id,
      rawStatus: toRawStatus(
        modificationStatus(modification, { settled: PaymentState.CANCELLED, requested: PaymentState.CANCEL_REQUESTED }),
      ),
      ...statusCodeOf(modification),
    };
  }

  /**
   * How many cancellations this refund is, against which charges, from one payment read. A shortfall refuses
   * the whole refund rather than returning part and reporting all. Vendor-allocated methods plan one slice.
   */
  async planRefund(cfg: StoreConfig, req: RefundPlanRequest): Promise<RefundPlanSlice[]> {
    if (refundsViaPayment(req.paymentMethod)) {
      return [{ amount: req.amount }];
    }

    const payment = await this.unzer.payments.get(toPspConnectionConfig(cfg), req.providerPaymentId);
    const { slices, shortfallCents } = allocateRefund(payment, req.amount.centAmount, req.fractionDigits);

    if (shortfallCents > 0) {
      throw new PspError(
        `The captured amount left on this payment is ${shortfallCents} minor units short of the requested refund.`,
        400,
      );
    }

    return slices.map((slice) => ({
      targetOperationId: slice.chargeId,
      amount: { centAmount: slice.amountCents, currencyCode: req.amount.currencyCode },
    }));
  }

  /** The operation id is charge-scoped: Unzer numbers a cancellation within its parent charge. */
  async refund(cfg: StoreConfig, req: RefundRequest): Promise<OperationResult> {
    const modification = await this.unzer.payments.refund(toPspConnectionConfig(cfg), {
      paymentId: req.providerPaymentId,
      ...(req.targetOperationId ? { chargeId: req.targetOperationId } : {}),
      ...(req.amount ? { amountCents: req.amount.centAmount } : {}),
      fractionDigits: req.fractionDigits,
      operationReference: req.operationReference,
    });
    return {
      providerOperationId: composeOperationIdentity(req.targetOperationId ?? '', modification.id),
      rawStatus: toRawStatus(
        modificationStatus(modification, { settled: PaymentState.REFUNDED, requested: PaymentState.REFUND_REQUESTED }),
      ),
      ...statusCodeOf(modification),
    };
  }
}
