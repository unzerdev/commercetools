/** What a provider resolves a shopper return from; both members are opaque to the core. */
export interface ReturnResolveRequest {
  query: Record<string, string | undefined>;
  context: Record<string, string>;
}
