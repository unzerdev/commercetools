/** The return context a provider reads back off a CT Payment's custom fields. */
export interface ReturnContext {
  shopperReturnUrl?: string;
  /** The provider's own stored context, threaded verbatim into `resolve`. */
  providerContext: Record<string, string>;
}
