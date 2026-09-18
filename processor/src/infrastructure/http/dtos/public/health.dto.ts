import { Static, Type } from '@sinclair/typebox';

/** `GET /health`: liveness only - the process is up and which build it is; no config, no downstream state. */
export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  name: Type.String(),
  version: Type.String(),
});

export type HealthResponseDTO = Static<typeof HealthResponseSchema>;
