/** Apple Pay's shopper-visible details, for the Apple Pay method only. */
export interface ApplePayMethodConfig {
  supportedNetworks?: string[];
  /** The label beside the total in Apple's sheet; falls back to the store's name. */
  label?: string;
}
