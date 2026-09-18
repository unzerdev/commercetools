import type { Money } from '../../../../domain';
import { toDecimalAmount } from '../amounts';

/** The input a charge/authorize runs on; `resourceId` is the tokenized payment type id (`resources.typeId`). */
export interface UnzerPaymentInput {
  resourceId: string;
  amount: Money;
  /** The currency's minor-unit exponent, the scale `amount` serializes in. */
  fractionDigits: number;
  returnUrl: string;
  orderId: string;
  paymentReference: string;
  basketId?: string;
  metadataId?: string;
  customerId?: string;
  /** Device-fingerprint id for risk assessment; travels as `additionalTransactionData.riskData`. */
  threatMetrixId?: string;
}

/** Capture an authorization; `amountCents` bare because the currency is fixed by the authorization. */
export interface UnzerCaptureInput {
  paymentId: string;
  amountCents?: number;
  fractionDigits: number;
  operationReference: string;
}

/** Cancel an authorization in full, or for a partial `amountCents`. */
export interface UnzerCancelInput {
  paymentId: string;
  amountCents?: number;
  fractionDigits: number;
  operationReference: string;
}

/** Refund a charge (`chargeId`), or across the charges at payment level when absent; omit `amountCents` for full. */
export interface UnzerRefundInput {
  paymentId: string;
  chargeId?: string;
  amountCents?: number;
  fractionDigits: number;
  operationReference: string;
}

/** The wire body shared by charge and authorize; every linked resource travels as an id under `resources`. */
export function paymentRequestBody(input: UnzerPaymentInput): Record<string, unknown> {
  return {
    amount: toDecimalAmount(input.amount.centAmount, input.fractionDigits),
    currency: input.amount.currencyCode,
    returnUrl: input.returnUrl,
    orderId: input.orderId,
    paymentReference: input.paymentReference,
    resources: {
      typeId: input.resourceId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.basketId ? { basketId: input.basketId } : {}),
      ...(input.metadataId ? { metadataId: input.metadataId } : {}),
    },
    ...(input.threatMetrixId
      ? { additionalTransactionData: { riskData: { threatMetrixId: input.threatMetrixId } } }
      : {}),
  };
}

/** A modification body carrying the partial amount as a decimal string, or empty for full. */
export function amountBody(amountCents: number | undefined, fractionDigits: number): Record<string, unknown> {
  return amountCents !== undefined ? { amount: toDecimalAmount(amountCents, fractionDigits) } : {};
}
