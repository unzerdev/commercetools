/** Methods whose refund is one payment-level charge-cancel call; the vendor owns the allocation. */
const REFUND_VIA_PAYMENT: ReadonlySet<string> = new Set([
  'paylater-invoice',
  'paylater-installment',
  'paylater-direct-debit',
  'klarna',
  'payu',
]);

/** Methods whose cancel addresses the payment by the merchant order reference, as the reference integration does. */
const CANCEL_BY_ORDER_REFERENCE_CODES: ReadonlySet<string> = new Set([
  'paylater-invoice',
  'paylater-installment',
  'paylater-direct-debit',
]);

/** Whether this method's refund is one payment-level call instead of a per-charge allocation. */
export const refundsViaPayment = (paymentMethod: string | undefined): boolean =>
  paymentMethod !== undefined && REFUND_VIA_PAYMENT.has(paymentMethod);

/** Whether this method's cancel addresses the payment by the merchant order reference. */
export const cancelsByOrderReference = (paymentMethod: string | undefined): boolean =>
  paymentMethod !== undefined && CANCEL_BY_ORDER_REFERENCE_CODES.has(paymentMethod);
