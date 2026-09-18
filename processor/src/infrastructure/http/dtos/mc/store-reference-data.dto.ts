import { Static, Type } from '@sinclair/typebox';

export const StoreReferenceDataResponseSchema = Type.Object({
  languages: Type.Array(Type.String(), { description: 'ISO language tags the store offers.' }),
  currencies: Type.Array(Type.String(), { description: 'ISO-4217 currencies the store may price in.' }),
  countries: Type.Array(Type.String(), { description: 'ISO-3166-1 alpha-2 countries the store ships to.' }),
});

export type StoreReferenceDataResponseSchemaDTO = Static<typeof StoreReferenceDataResponseSchema>;
