import type { UnzerTransaction } from '../client';
import { reversesAuthorization } from './resource-url';

/** What a leg is, independent of which of the vendor's two `type` vocabularies named it. */
export type UnzerLegKind = 'authorization' | 'charge' | 'void' | 'refund' | 'chargeback' | 'unknown';

/**
 * Classify one leg. Unzer speaks two vocabularies: the payment read names `charge` / `cancel-charge` /
 * `cancel-authorize` / `authorize`, the API reference the generic `authorization` / `cancellation`. Both
 * collapse here; the generic `cancellation` reads its parent off the url. `unknown` is never a guess.
 */
export function legKind(leg: UnzerTransaction): UnzerLegKind {
  switch (leg.type) {
    case 'authorize':
    case 'authorization':
      return 'authorization';
    case 'charge':
      return 'charge';
    case 'cancel-authorize':
      return 'void';
    case 'cancel-charge':
      return 'refund';
    case 'cancellation':
      return reversesAuthorization(leg.url) ? 'void' : 'refund';
    case 'chargeback':
      return 'chargeback';
    default:
      return 'unknown';
  }
}
