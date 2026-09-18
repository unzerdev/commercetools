import { isOfferableMethod } from './offerable';

/**
 * The merchandising order every method list renders in, applied at the catalogue boundary both surfaces
 * read through. Every code the support table declares appears exactly once (held by a spec).
 */
export const METHOD_DISPLAY_ORDER: readonly string[] = [
  'paylater-invoice',
  'paylater-installment',
  'paylater-direct-debit',
  'openbanking-pis',
  'card',
  'clicktopay',
  'applepay',
  'googlepay',
  'wero',
  'klarna',
  'EPS',
  'ideal',
  'przelewy24',
  'twint',
  'post-finance-card',
  'post-finance-efinance',
  'payu',
  'sepa-direct-debit',
  'prepayment',
  'invoice-secured',
  'installment-secured',
  'bancontact',
  'paypal',
  'alipay',
  'wechatpay',
];

const displayPosition = (code: string): number => {
  const at = METHOD_DISPLAY_ORDER.indexOf(code);
  return at === -1 ? Number.POSITIVE_INFINITY : at;
};

/** The methods in display order; stable, so unplaced codes keep their arrival order and sort last. */
export function inDisplayOrder<T extends { code: string }>(methods: T[]): T[] {
  return [...methods].sort((a, b) => displayPosition(a.code) - displayPosition(b.code));
}

/** Every code this connector can offer, in display order. The enabler's element map must match this set. */
export const OFFERABLE_METHOD_CODES: readonly string[] = METHOD_DISPLAY_ORDER.filter((code) => isOfferableMethod(code));
