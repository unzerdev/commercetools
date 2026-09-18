/** A write-ahead reservation lost its race: the payment moved between the read and the write. Nothing reached the vendor. */
export class PaymentVersionConflict extends Error {
  readonly paymentId: string;
  readonly version: number;

  constructor(paymentId: string, version: number) {
    super('The payment changed while this operation was being reserved. Reload the payment and try again.');
    this.name = 'PaymentVersionConflict';
    this.paymentId = paymentId;
    this.version = version;
    Object.setPrototypeOf(this, PaymentVersionConflict.prototype);
  }
}
