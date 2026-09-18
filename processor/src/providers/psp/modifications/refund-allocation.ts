import { fromDecimalAmount, type UnzerPayment, type UnzerTransaction } from '../client';
import { legKind, parentChargeId, resourceId } from '../status';

/** One vendor call the refund resolves to: how much comes off which charge. */
export interface RefundSlice {
  chargeId: string;
  amountCents: number;
}

interface ChargeRemainder {
  chargeId: string;
  refundableCents: number;
}

/** A leg's decimal wire amount in minor units by integer parse; an absent or malformed amount contributes nothing. */
function legCents(leg: UnzerTransaction, fractionDigits: number): number | undefined {
  return fromDecimalAmount(leg.amount, 'XXX', fractionDigits)?.centAmount;
}

/**
 * What is still refundable on each succeeded charge, oldest first. The payment reports no cancelled amount per
 * charge, so it is derived from the cancellation legs naming that charge as parent; a pending cancellation
 * spends headroom like a settled one, so the remainder is never overstated.
 */
export function chargeRemainders(payment: UnzerPayment, fractionDigits: number): ChargeRemainder[] {
  const legs = payment.transactions ?? [];

  const cancelledByCharge = new Map<string, number>();
  legs.forEach((leg) => {
    if (legKind(leg) !== 'refund' || leg.status === 'error') {
      return;
    }
    const parent = parentChargeId(leg.url);
    const cents = legCents(leg, fractionDigits);
    if (parent === '' || cents === undefined) {
      return;
    }
    cancelledByCharge.set(parent, (cancelledByCharge.get(parent) ?? 0) + cents);
  });

  return legs
    .filter((leg) => legKind(leg) === 'charge' && leg.status === 'success')
    .map((leg) => {
      const chargeId = resourceId(leg.url);
      const charged = legCents(leg, fractionDigits) ?? 0;
      return { chargeId, refundableCents: charged - (cancelledByCharge.get(chargeId) ?? 0) };
    })
    .filter((remainder) => remainder.chargeId !== '' && remainder.refundableCents > 0);
}

/**
 * Split a refund across the charges that can carry it, oldest first. When the charges hold less than asked, the
 * slices cover what they hold and `shortfallCents` says the rest; the caller decides, never a silent partial.
 */
export function allocateRefund(
  payment: UnzerPayment,
  requestedCents: number,
  fractionDigits: number,
): { slices: RefundSlice[]; shortfallCents: number } {
  let remaining = requestedCents;
  const slices: RefundSlice[] = [];

  for (const { chargeId, refundableCents } of chargeRemainders(payment, fractionDigits)) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, refundableCents);
    slices.push({ chargeId, amountCents: take });
    remaining -= take;
  }

  return { slices, shortfallCents: Math.max(remaining, 0) };
}
