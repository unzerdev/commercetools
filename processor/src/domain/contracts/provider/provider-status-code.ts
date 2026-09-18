/** The vendor's own status code and message, display-only: written to `paymentStatus.interfaceCode/Text`. */
export interface ProviderStatusCode {
  code: string;
  /** Merchant-facing, never shopper-facing. */
  text?: string;
}
