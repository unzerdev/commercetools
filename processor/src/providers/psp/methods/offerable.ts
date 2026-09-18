import { METHOD_TRANSACTION_SUPPORT } from './transaction-support';

/** Codes merged into another method's surface (Click to Pay rides on the card), matched on a normalized key. */
const MERGED_METHOD_KEYS: ReadonlySet<string> = new Set<string>(['clicktopay']);

/** Known codes with no shopper surface: the retired predecessors of the paylater family. */
const UNRENDERABLE_METHOD_CODES: ReadonlySet<string> = new Set<string>(['installment-secured', 'invoice-secured']);

function normalizedMethodKey(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether the code is merged into another method and never reaches a configuration or checkout surface. */
export function isMergedMethod(code: string): boolean {
  return MERGED_METHOD_KEYS.has(normalizedMethodKey(code));
}

/**
 * Whether this connector can offer the catalogue code: not merged, known to the support table (an account may
 * serve types this release never implemented) and rendered by a shopper surface.
 */
export function isOfferableMethod(code: string): boolean {
  if (isMergedMethod(code)) {
    return false;
  }
  return METHOD_TRANSACTION_SUPPORT[code] !== undefined && !UNRENDERABLE_METHOD_CODES.has(code);
}
