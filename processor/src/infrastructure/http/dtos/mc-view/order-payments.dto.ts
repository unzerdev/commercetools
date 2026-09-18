import { Static, Type } from '@sinclair/typebox';
import { AmountSchema } from '../shared/primitives.dto';

/** Display members only; the raw status envelope is never declared, so the serializer strips it. */
const OperationSchema = Type.Object({
  id: Type.Optional(Type.String({ maxLength: 256 })),
  type: Type.Optional(Type.String({ maxLength: 256 })),
  date: Type.Optional(Type.String({ maxLength: 256 })),
  outcome: Type.Optional(Type.Union([Type.Literal('success'), Type.Literal('pending'), Type.Literal('error')])),
  amount: Type.Optional(AmountSchema),
});

const PaymentDetailsAmountsSchema = Type.Object({
  total: Type.Optional(AmountSchema),
  authorized: Type.Optional(AmountSchema),
  charged: Type.Optional(AmountSchema),
  cancelled: Type.Optional(AmountSchema),
  refunded: Type.Optional(AmountSchema),
});

const PaymentDetailsSchema = Type.Object({
  rawStatus: Type.String({ maxLength: 256, description: 'The vendor status string, display only.' }),
  orderId: Type.Optional(Type.String({ maxLength: 256 })),
  amounts: Type.Optional(PaymentDetailsAmountsSchema),
  operations: Type.Array(OperationSchema),
});

const PaymentDetailsUnavailableSchema = Type.Object({
  unavailable: Type.Literal(true),
  reason: Type.String(),
});

const OrderPaymentSchema = Type.Object({
  id: Type.String(),
  providerPaymentId: Type.Optional(Type.String()),
  merchantReference: Type.Optional(Type.String()),
  inReview: Type.Boolean(),
  paymentMethod: Type.Optional(Type.String()),
  amountPlanned: AmountSchema,
  fractionDigits: Type.Integer({ minimum: 0 }),
  capturableAmount: AmountSchema,
  refundableAmount: AmountSchema,
  details: Type.Union([PaymentDetailsSchema, PaymentDetailsUnavailableSchema]),
});

/** `GET /operations/orders/:orderId/payments`: the whole panel in one payload; no undeclared leaf reaches the wire. */
export const OrderPaymentsResponseSchema = Type.Object({
  payments: Type.Array(OrderPaymentSchema),
});

export type OrderPaymentsResponseSchemaDTO = Static<typeof OrderPaymentsResponseSchema>;
