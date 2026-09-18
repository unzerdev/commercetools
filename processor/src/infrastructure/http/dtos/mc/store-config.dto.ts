import { Static, Type } from '@sinclair/typebox';
import { EnvironmentModeSchema } from '../shared/primitives.dto';

const SECRET_MAX_LENGTH = 512;
const CREDENTIALS_MAX_PROPERTIES = 16;

/** `host` and `webhookUrl` are server-authoritative and not accepted here. */
const EnvironmentBlockSchema = Type.Object(
  {
    credentials: Type.Optional(
      Type.Record(Type.String(), Type.String({ maxLength: SECRET_MAX_LENGTH }), {
        maxProperties: CREDENTIALS_MAX_PROPERTIES,
      }),
    ),
    webhookSecret: Type.Optional(Type.String({ maxLength: SECRET_MAX_LENGTH })),
  },
  { additionalProperties: false },
);

const EnvironmentsSchema = Type.Object(
  {
    sandbox: Type.Optional(EnvironmentBlockSchema),
    live: Type.Optional(EnvironmentBlockSchema),
  },
  { additionalProperties: false },
);

/** `GET`/`PUT /operations/store-config`. The response masks `webhookSecret`; credentials return in the clear. */
export const StoreConfigRequestSchema = Type.Object(
  {
    mode: Type.Optional(EnvironmentModeSchema),
    environments: Type.Optional(EnvironmentsSchema),
    settings: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const StoreConfigResponseSchema = StoreConfigRequestSchema;

export type StoreConfigRequestSchemaDTO = Static<typeof StoreConfigRequestSchema>;
export type StoreConfigResponseSchemaDTO = Static<typeof StoreConfigResponseSchema>;
