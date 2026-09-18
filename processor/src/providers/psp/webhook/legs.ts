import type { UnzerPayment, UnzerTransaction } from '../client';
import { legDateIso } from '../mapping';
import { operationIdentity, parentChargeId, resourceId } from '../status';

/**
 * The leg an event settled, chosen from the fetched payment: among the legs `admits` allows, the one whose
 * identity matches the delivered url, else the newest by its own date. Charge-scoped when the url names a
 * parent charge. `undefined` when the payment carries no settleable leg.
 */
export function operationLeg(
  payment: UnzerPayment,
  admits: (leg: UnzerTransaction) => boolean,
  retrieveUrl: string | undefined,
): UnzerTransaction | undefined {
  const legs = (payment.transactions ?? []).filter((leg) => admits(leg) && resourceId(leg.url) !== '');
  const scoped = parentChargeId(retrieveUrl) !== '';
  const key = (url: string | undefined): string => (scoped ? operationIdentity(url) : resourceId(url));
  const reference = key(retrieveUrl);
  const named = reference !== '' ? legs.find((leg) => key(leg.url) === reference) : undefined;
  return named ?? newestLeg(legs);
}

/** The most recently booked candidate; a leg without a parseable date sorts oldest. */
function newestLeg(legs: UnzerTransaction[]): UnzerTransaction | undefined {
  return legs.reduce<UnzerTransaction | undefined>((newest, leg) => {
    if (newest === undefined) {
      return leg;
    }
    return legInstant(leg) >= legInstant(newest) ? leg : newest;
  }, undefined);
}

function legInstant(leg: UnzerTransaction): number {
  const parsed = leg.date === undefined ? NaN : Date.parse(legDateIso(leg.date));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
