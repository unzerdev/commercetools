import type { PspConnectionConfig } from '../connection';
import type { PspTransport } from '../transport';
import {
  amountBody,
  paymentRequestBody,
  type UnzerCancelInput,
  type UnzerCaptureInput,
  type UnzerPaymentInput,
  type UnzerRefundInput,
} from '../requests/payments';
import type { UnzerModification, UnzerPayment } from '../responses/payments';

/** The payments resource surface a test can stand in for. */
export interface PaymentsApi {
  charge(cfg: PspConnectionConfig, input: UnzerPaymentInput): Promise<UnzerPayment>;
  authorize(cfg: PspConnectionConfig, input: UnzerPaymentInput): Promise<UnzerPayment>;
  get(cfg: PspConnectionConfig, paymentId: string): Promise<UnzerPayment>;
  capture(cfg: PspConnectionConfig, input: UnzerCaptureInput): Promise<UnzerModification>;
  cancelAuthorization(cfg: PspConnectionConfig, input: UnzerCancelInput): Promise<UnzerModification>;
  refund(cfg: PspConnectionConfig, input: UnzerRefundInput): Promise<UnzerModification>;
}

/** Every money-moving call sends its stable name as the idempotency key, so a retry is the same operation to Unzer. */
export class PaymentsResource implements PaymentsApi {
  constructor(private readonly transport: PspTransport) {}

  /** `POST /v1/payments/charges` (plural: the singular binds `charge` as a payment id and answers 405). */
  public async charge(cfg: PspConnectionConfig, input: UnzerPaymentInput): Promise<UnzerPayment> {
    const body = await this.transport.send(cfg, {
      method: 'POST',
      path: '/v1/payments/charges',
      body: paymentRequestBody(input),
      idempotencyKey: input.paymentReference,
    });
    return (body ?? {}) as UnzerPayment;
  }

  /** `POST /v1/payments/authorize`, the same body as a charge. */
  public async authorize(cfg: PspConnectionConfig, input: UnzerPaymentInput): Promise<UnzerPayment> {
    const body = await this.transport.send(cfg, {
      method: 'POST',
      path: '/v1/payments/authorize',
      body: paymentRequestBody(input),
      idempotencyKey: input.paymentReference,
    });
    return (body ?? {}) as UnzerPayment;
  }

  /** `GET /v1/payments/{id}`: the authoritative state the return leg and the webhook read. */
  public async get(cfg: PspConnectionConfig, paymentId: string): Promise<UnzerPayment> {
    const body = await this.transport.send(cfg, {
      method: 'GET',
      path: `/v1/payments/${encodeURIComponent(paymentId)}`,
    });
    return (body ?? {}) as UnzerPayment;
  }

  /** `POST /v1/payments/{id}/charges`: a capture is a charge against the authorization. */
  public async capture(cfg: PspConnectionConfig, input: UnzerCaptureInput): Promise<UnzerModification> {
    const body = await this.transport.send(cfg, {
      method: 'POST',
      path: `/v1/payments/${encodeURIComponent(input.paymentId)}/charges`,
      body: amountBody(input.amountCents, input.fractionDigits),
      idempotencyKey: input.operationReference,
    });
    return (body ?? {}) as UnzerModification;
  }

  /** `POST /v1/payments/{id}/authorize/cancels`: void the still-reserved funds. */
  public async cancelAuthorization(cfg: PspConnectionConfig, input: UnzerCancelInput): Promise<UnzerModification> {
    const body = await this.transport.send(cfg, {
      method: 'POST',
      path: `/v1/payments/${encodeURIComponent(input.paymentId)}/authorize/cancels`,
      body: amountBody(input.amountCents, input.fractionDigits),
      idempotencyKey: input.operationReference,
    });
    return (body ?? {}) as UnzerModification;
  }

  /** A refund is a cancellation on a charge; without `chargeId` the payment-level route refunds across charges. */
  public async refund(cfg: PspConnectionConfig, input: UnzerRefundInput): Promise<UnzerModification> {
    const paymentId = encodeURIComponent(input.paymentId);
    const path = input.chargeId
      ? `/v1/payments/${paymentId}/charges/${encodeURIComponent(input.chargeId)}/cancels`
      : `/v1/payments/${paymentId}/charges/cancels`;
    const body = await this.transport.send(cfg, {
      method: 'POST',
      path,
      body: amountBody(input.amountCents, input.fractionDigits),
      idempotencyKey: input.operationReference,
    });
    return (body ?? {}) as UnzerModification;
  }
}
