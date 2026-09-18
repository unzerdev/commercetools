/** What the shopper surface must do after a payment call: an open discriminated union. */
export type FollowUpAction =
  | { kind: 'redirect'; payload: { url: string } }
  | { kind: 'sdkAction'; payload: Record<string, unknown> }
  | { kind: 'display'; payload: Record<string, unknown> }
  | { kind: 'none'; payload?: undefined };
