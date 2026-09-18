/** The response body of an SDK request builder, so no commercetools resource type is declared twice. */
export type Execute<T> = T extends { execute: () => Promise<{ body: infer B }> } ? B : never;
