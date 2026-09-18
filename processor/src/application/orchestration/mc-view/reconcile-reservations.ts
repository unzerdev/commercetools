import type { CtTransactionType, ProviderOperation } from '../../../domain';
import { isMintedOperationReference, ReservedLegMissing, resolveStateEffect } from '../../../domain';
import type { Payment, ReservedLeg } from '../../ports';
import type { OrchestrationDeps, OrchestrationEnv } from '../shared';

/** What the staleness window adds on top of the vendor deadline: the closing write, its retries, clock skew. */
export const RECONCILE_MARGIN_MS = 5 * 60 * 1000;

/** How long a leg under its minted name must have stood before a load may call it wedged. */
export const reconcileAfterMs = (requestTimeoutMs: number): number => requestTimeoutMs + RECONCILE_MARGIN_MS;

/** The only types a reservation writes; a `Pending` Authorization is a payment in review, never a reservation. */
const RESERVABLE_TYPES: readonly string[] = ['Charge', 'Refund', 'CancelAuthorization'];

const isReservableType = (type: string): type is CtTransactionType => RESERVABLE_TYPES.includes(type);

const isStale = (timestamp: string | undefined, afterMs: number): boolean => {
  if (timestamp === undefined) {
    return false;
  }
  const reservedAt = Date.parse(timestamp);

  return Number.isFinite(reservedAt) && Date.now() - reservedAt >= afterMs;
};

interface StandingLeg {
  handle: ReservedLeg;
  timestamp?: string;
}

/** The `Pending` legs of a reservable type that carry a key. */
function standingLegs(payment: Payment): StandingLeg[] {
  const standing: StandingLeg[] = [];
  for (const leg of payment.transactions) {
    const reference = leg.interactionId;
    if (reference === undefined || leg.state !== 'Pending' || !isReservableType(leg.type)) {
      continue;
    }
    standing.push({ handle: { type: leg.type, interactionId: reference }, timestamp: leg.timestamp });
  }

  return standing;
}

const isMintedLeg = (leg: StandingLeg, payment: Payment, brandPrefix: string): boolean =>
  isMintedOperationReference(brandPrefix, payment.id, leg.handle.type, leg.handle.interactionId);

/**
 * Report every leg still under the name the reservation minted past the staleness window: no vendor
 * operation ever echoes that name, so only the operator's runbook clears it. Independent of the vendor read.
 */
export function reportMintedLegs(payment: Payment, requestTimeoutMs: number, env: OrchestrationEnv): void {
  const afterMs = reconcileAfterMs(requestTimeoutMs);
  for (const leg of standingLegs(payment)) {
    if (!isMintedLeg(leg, payment, env.brand.paymentInterface) || !isStale(leg.timestamp, afterMs)) {
      continue;
    }
    env.logger.error(
      'A leg still carries the name the reservation minted; the headroom stays shut until it is cleared',
      {
        paymentId: payment.id,
        transactionType: leg.handle.type,
        interactionId: leg.handle.interactionId,
      },
    );
  }
}

/** The standing legs an operation list can match: everything already keyed on a vendor id. */
function reconcilableLegs(payment: Payment, brandPrefix: string): ReservedLeg[] {
  return standingLegs(payment)
    .filter((leg) => !isMintedLeg(leg, payment, brandPrefix))
    .map((leg) => leg.handle);
}

type LegResolution = { state: 'Failure' } | { state: 'Success' | 'Pending'; providerOperationId: string };

/** A leg judged against the operation the vendor reports for it, through the state machine. */
function legResolution(
  operation: ProviderOperation,
  providerOperationId: string,
  deps: OrchestrationDeps,
): LegResolution {
  const effect = resolveStateEffect(deps.provider.mapProviderStatus(operation.rawStatus));
  if (effect.kind === 'transaction' && effect.transaction.state === 'Failure') {
    return { state: 'Failure' };
  }
  const settled = effect.kind === 'transaction' && effect.transaction.state === 'Success';

  return { state: settled ? 'Success' : 'Pending', providerOperationId };
}

async function resolveLeg(
  paymentId: string,
  reserved: ReservedLeg,
  resolution: LegResolution,
  deps: OrchestrationDeps,
): Promise<void> {
  if (resolution.state === 'Failure') {
    await deps.ports.paymentStore.release(paymentId, reserved);
    return;
  }
  await deps.ports.paymentStore.settle(paymentId, reserved, resolution);
}

/** The payment as commercetools now holds it; falls back to the read copy when the re-read fails. */
async function heldPayment(payment: Payment, env: OrchestrationEnv, deps: OrchestrationDeps): Promise<Payment> {
  try {
    return await deps.ports.paymentStore.get(payment.id);
  } catch (error) {
    env.logger.warn('Could not re-read a reconciled payment; the panel renders it as it was read', {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return payment;
  }
}

/**
 * Close every standing leg the provider reports an operation for; a leg it does not report is left alone,
 * since absence is not evidence. Best-effort per leg; returns the reconciled payment.
 */
export async function reconcileReservations(
  payment: Payment,
  operations: ProviderOperation[],
  env: OrchestrationEnv,
  deps: OrchestrationDeps,
): Promise<Payment> {
  const reconcilable = reconcilableLegs(payment, env.brand.paymentInterface);
  if (reconcilable.length === 0) {
    return payment;
  }

  let moved = false;

  for (const reserved of reconcilable) {
    const operation = operations.find((candidate) => candidate.id === reserved.interactionId);
    if (operation === undefined) {
      env.logger.warn('The provider reports no operation under the id a standing leg carries; the leg stays', {
        paymentId: payment.id,
        transactionType: reserved.type,
        interactionId: reserved.interactionId,
      });
      continue;
    }
    try {
      const resolution = legResolution(operation, reserved.interactionId, deps);
      if (resolution.state === 'Pending') {
        continue;
      }
      await resolveLeg(payment.id, reserved, resolution, deps);
      moved = true;
    } catch (error) {
      if (error instanceof ReservedLegMissing) {
        moved = true;
        env.logger.info('A standing reservation was already resolved by a concurrent load', {
          paymentId: payment.id,
          interactionId: reserved.interactionId,
        });
        continue;
      }
      env.logger.warn('Could not resolve a standing reservation; the leg stays and the headroom stays shut', {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return moved ? heldPayment(payment, env, deps) : payment;
}
