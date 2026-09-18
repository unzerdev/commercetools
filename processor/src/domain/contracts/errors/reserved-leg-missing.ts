/** Closing a reserved leg found none under its minted name: a concurrent load already re-keyed it. */
export class ReservedLegMissing extends Error {
  readonly paymentId: string;
  readonly interactionId: string;

  constructor(paymentId: string, interactionId: string) {
    super(`No reserved transaction '${interactionId}' on payment ${paymentId}.`);
    this.name = 'ReservedLegMissing';
    this.paymentId = paymentId;
    this.interactionId = interactionId;
    Object.setPrototypeOf(this, ReservedLegMissing.prototype);
  }
}
