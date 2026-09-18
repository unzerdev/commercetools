import { Static, Type } from '@sinclair/typebox';

/** Mirrors the enabler's `DropinType` union so the response stays a superset of its contract. */
const DropinType = Type.Enum({
  EMBEDDED: 'embedded',
  HPP: 'hpp',
  HPP_PRESELECTED: 'hpp-preselected',
});

export const SupportedPaymentDropinsData = Type.Object({
  type: DropinType,
});

export const SupportedPaymentComponentsData = Type.Object({
  type: Type.String(),
  subtypes: Type.Optional(Type.Array(Type.String())),
});

export const SupportedExpressPaymentData = Type.Object({
  type: Type.String(),
});

export const SupportedPaymentComponentsSchema = Type.Object({
  dropins: Type.Array(SupportedPaymentDropinsData),
  components: Type.Array(SupportedPaymentComponentsData),
  express: Type.Array(SupportedExpressPaymentData),
});

export type SupportedPaymentComponentsSchemaDTO = Static<typeof SupportedPaymentComponentsSchema>;
