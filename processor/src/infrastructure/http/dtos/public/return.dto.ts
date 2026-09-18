import { Static, Type } from '@sinclair/typebox';

/** `GET /return`: only `ctPaymentId` is ours; every other query parameter is the vendor's and passes through. */
export const ReturnQuerySchema = Type.Object(
  {
    ctPaymentId: Type.String({ description: 'commercetools Payment id this return closes.' }),
  },
  { additionalProperties: true },
);

export type ReturnQueryDTO = Static<typeof ReturnQuerySchema>;
