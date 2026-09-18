import { Type } from '@sinclair/typebox';

/** The wire twins of the domain's common types, defined once so no DTO redefines a literal union. */
export const EnvironmentModeSchema = Type.Union([Type.Literal('sandbox'), Type.Literal('live')]);
export const BookingModeSchema = Type.Union([Type.Literal('charge'), Type.Literal('authorize')]);
export const SalutationSchema = Type.Union([Type.Literal('mr'), Type.Literal('mrs'), Type.Literal('unknown')]);
export const CustomerTypeSchema = Type.Union([Type.Literal('B2B'), Type.Literal('B2C')]);
export const LocalizedTextSchema = Type.Record(Type.String(), Type.String());
export const AmountSchema = Type.Object({
  centAmount: Type.Integer(),
  currencyCode: Type.String(),
});
/** ISO-4217 keys, non-negative minor-unit integers; strict so a mis-cased key cannot slip through. */
export const CurrencyAmountMapSchema = Type.Record(
  Type.String({ pattern: '^[A-Z]{3}$' }),
  Type.Integer({ minimum: 0 }),
  {
    additionalProperties: false,
  },
);
