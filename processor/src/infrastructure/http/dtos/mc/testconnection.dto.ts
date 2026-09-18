import { Static, Type } from '@sinclair/typebox';

/** A secret-free probe outcome; `field` names the connection field a failure belongs to, when attributable. */
export const TestConnectionResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
  field: Type.Optional(Type.String()),
});

export type TestConnectionResponseSchemaDTO = Static<typeof TestConnectionResponseSchema>;
