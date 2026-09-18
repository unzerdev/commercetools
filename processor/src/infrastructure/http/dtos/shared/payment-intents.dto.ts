import { Static, Type } from '@sinclair/typebox';
import { PaymentModificationStatus } from '../../../../domain';
import { AmountSchema } from './primitives.dto';

export const ActionCapturePaymentSchema = Type.Object({
  action: Type.Literal('capturePayment'),
  amount: AmountSchema,
  merchantReference: Type.Optional(Type.String()),
});

export const ActionRefundPaymentSchema = Type.Object({
  action: Type.Literal('refundPayment'),
  amount: AmountSchema,
  merchantReference: Type.Optional(Type.String()),
  transactionId: Type.Optional(Type.String()),
});

export const ActionCancelPaymentSchema = Type.Object({
  action: Type.Literal('cancelPayment'),
  amount: Type.Optional(AmountSchema),
  merchantReference: Type.Optional(Type.String()),
});

export const ActionReversePaymentSchema = Type.Object({
  action: Type.Literal('reversePayment'),
  merchantReference: Type.Optional(Type.String()),
});

/** Exactly one action per intent: the headroom guard judges one action against one snapshot. */
export const PaymentIntentRequestSchema = Type.Object({
  actions: Type.Array(
    Type.Union([
      ActionCapturePaymentSchema,
      ActionRefundPaymentSchema,
      ActionCancelPaymentSchema,
      ActionReversePaymentSchema,
    ]),
    { minItems: 1, maxItems: 1 },
  ),
});

export const PaymentIntentResponseSchema = Type.Object({
  outcome: Type.Enum(PaymentModificationStatus),
});

export type PaymentIntentRequestSchemaDTO = Static<typeof PaymentIntentRequestSchema>;
export type PaymentIntentResponseSchemaDTO = Static<typeof PaymentIntentResponseSchema>;
