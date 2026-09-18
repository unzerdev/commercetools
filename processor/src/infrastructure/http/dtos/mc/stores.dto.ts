import { Static, Type } from '@sinclair/typebox';

const StoreSummarySchema = Type.Object({
  key: Type.String({ description: 'The store key the config endpoints scope on (X-Store-Key).' }),
  name: Type.String({ description: "The store's display name, else its key when unnamed." }),
  isDefault: Type.Optional(Type.Boolean({ description: 'Set on the first entry only: the default scope.' })),
});

export const StoresResponseSchema = Type.Array(StoreSummarySchema);

export type StoresResponseSchemaDTO = Static<typeof StoresResponseSchema>;
