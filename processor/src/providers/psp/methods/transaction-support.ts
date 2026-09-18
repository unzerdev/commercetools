import type { BookingMode } from '../../../domain';

/** What one keypair method-type code supports; `authorize` and `charge` are independent. */
export interface MethodTransactionSupport {
  authorize: boolean;
  charge: boolean;
  /** The kind booked when the merchant configured none; one this method supports. */
  default: BookingMode;
}

/**
 * The static per-method transaction support table, keyed by the keypair catalogue codes. Filled from the
 * vendor's published booking behaviour and a live sandbox probe: authorize answers 405 for the charge-only
 * family, charge answers 500 for the paylater family. Booking an unsupported kind is a refused payment.
 */
export const METHOD_TRANSACTION_SUPPORT: Readonly<Record<string, MethodTransactionSupport>> = {
  card: { authorize: true, charge: true, default: 'authorize' },
  paypal: { authorize: true, charge: true, default: 'authorize' },
  wero: { authorize: true, charge: true, default: 'authorize' },
  applepay: { authorize: true, charge: true, default: 'charge' },
  googlepay: { authorize: true, charge: true, default: 'charge' },
  klarna: { authorize: true, charge: false, default: 'authorize' },
  'paylater-invoice': { authorize: true, charge: false, default: 'authorize' },
  'paylater-installment': { authorize: true, charge: false, default: 'authorize' },
  'paylater-direct-debit': { authorize: true, charge: false, default: 'authorize' },
  'installment-secured': { authorize: true, charge: false, default: 'authorize' },
  'invoice-secured': { authorize: true, charge: false, default: 'authorize' },
  alipay: { authorize: false, charge: true, default: 'charge' },
  bancontact: { authorize: false, charge: true, default: 'charge' },
  clicktopay: { authorize: false, charge: true, default: 'charge' },
  EPS: { authorize: false, charge: true, default: 'charge' },
  ideal: { authorize: false, charge: true, default: 'charge' },
  'openbanking-pis': { authorize: false, charge: true, default: 'charge' },
  payu: { authorize: false, charge: true, default: 'charge' },
  'post-finance-card': { authorize: false, charge: true, default: 'charge' },
  'post-finance-efinance': { authorize: false, charge: true, default: 'charge' },
  prepayment: { authorize: false, charge: true, default: 'charge' },
  przelewy24: { authorize: false, charge: true, default: 'charge' },
  'sepa-direct-debit': { authorize: false, charge: true, default: 'charge' },
  twint: { authorize: false, charge: true, default: 'charge' },
  wechatpay: { authorize: false, charge: true, default: 'charge' },
};

/** The conservative answer for a code the table does not know: a direct charge and nothing else. */
const UNKNOWN_METHOD_SUPPORT: MethodTransactionSupport = { authorize: false, charge: true, default: 'charge' };

function transactionSupport(code: string): MethodTransactionSupport {
  return METHOD_TRANSACTION_SUPPORT[code] ?? UNKNOWN_METHOD_SUPPORT;
}

/** Whether the code supports a two-step (authorize then capture) transaction. */
export function supportsTwoStep(code: string): boolean {
  return transactionSupport(code).authorize;
}

/** Whether the code accepts a direct charge. */
export function supportsCharge(code: string): boolean {
  return transactionSupport(code).charge;
}

/** The kind booked for a method whose merchant config names none. */
export function defaultBookingMode(code: string): BookingMode {
  return transactionSupport(code).default;
}

/**
 * The kind the pay path books: a method with one possible kind uses it regardless of the configured mode,
 * since a stored choice cannot make the vendor accept a transaction it refuses.
 */
export function resolveBookingMode(code: string, configured: BookingMode | undefined): BookingMode {
  const support = transactionSupport(code);
  if (!support.charge) {
    return 'authorize';
  }
  if (!support.authorize) {
    return 'charge';
  }
  return configured ?? support.default;
}
