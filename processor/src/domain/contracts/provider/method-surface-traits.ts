/** What a method's checkout surface needs, static per method code. */
export interface MethodSurfaceTraits {
  /** The vendor refuses the charge without a described payer. */
  requiresCustomerData: boolean;
  /** The surface needs amount, currency and country before it can be paid with. */
  needsAmountData: boolean;
  /** The surface draws its own pay button. */
  rendersOwnPayButton: boolean;
  /** The surface can carry Click to Pay alongside its own form. */
  carriesClickToPay: boolean;
}
