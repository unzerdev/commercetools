import { Static, Type } from '@sinclair/typebox';
import { EnvironmentModeSchema } from '../shared/primitives.dto';

/** `DELETE /operations/store-config`: the environment to disconnect; omitted, the stored active one. */
export const DisconnectStoreConfigQuerySchema = Type.Object({
  mode: Type.Optional(EnvironmentModeSchema),
});

export type DisconnectStoreConfigQuerySchemaDTO = Static<typeof DisconnectStoreConfigQuerySchema>;
