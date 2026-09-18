/**
 * A `PaymentStore` double whose `update` REPLAYS the commercetools SDK's transaction consolidation and
 * whose `reserve` REPLAYS commercetools' version CAS, so a write feeds the next read.
 *
 * The double-spend specs cannot be written against a bare `jest.fn()` store. The defect under test is that
 * an operation the vendor has ACCEPTED must become visible to the next request's headroom, and the safety
 * of the fix is that the settling webhook lands on the leg the intent already wrote instead of appending a
 * second one. Both are properties of the write→read loop, so the loop has to be real: two mutually-mocked
 * sides would agree with each other and prove nothing.
 *
 * The rules mirror `DefaultPaymentService.consolidateTransactionChanges`
 * (@commercetools/connect-payments-sdk 0.28.0): a draft transaction that matches an existing leg by TYPE +
 * `interactionId` advances THAT leg's state along `Initial → Pending → Success|Failure`; anything else is
 * appended as a new leg.
 *
 * `settle` and `release` mirror the OTHER real write path — `payment.repository::changeReservedLeg` — including
 * the two decisions it takes on its own, which a caller therefore cannot assume away: it INVERTS a settle into
 * a release when the settling webhook already appended its own leg under the vendor operation id, and it
 * THROWS {@link ReservedLegMissing} when no leg stands under the reserved name. A double that simply did what
 * it was told would agree with any caller that projected its own request as the outcome.
 */
import { jest } from '@jest/globals';
import { PaymentVersionConflict, ReservedLegMissing } from '../../src/domain';
import type { CorePorts } from '../../src/application/ports';

/** The SDK's allowed transaction-state transitions; a draft outside them leaves the leg untouched. */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  Initial: ['Pending', 'Success', 'Failure'],
  Pending: ['Success', 'Failure'],
  Failure: ['Success'],
  Success: ['Failure'],
};

export interface StatefulPaymentStore {
  /** The live CT Payment every `get` returns — assert the transaction legs on it. */
  current(): any;
  /** The port to install on the fake `CorePorts`. */
  port: CorePorts['paymentStore'];
}

/** A `PaymentStore` over one mutable CT Payment, consolidating writes the way the SDK does. */
export function statefulPaymentStore(initial: any): StatefulPaymentStore {
  // The legs are COPIED, never shared: a caller may hand the same fixture to the store and to the read that
  // the store's writes are supposed to diverge from, and a shared leg object would quietly reconcile the two.
  const payment: any = {
    ...initial,
    version: initial.version ?? 1,
    transactions: initial.transactions.map((leg: any) => ({ ...leg })),
  };
  let sequence = 0;

  /**
   * The reserved leg, found by the handle it was reserved under: its TYPE and the id it was named by (or
   * the vendor id `settle` re-keyed it to). Type + id, exactly as the repository selects it — an id alone
   * does not identify a leg, since a leg of another type may legitimately carry the same vendor id.
   */
  const legBy = (reserved: { type: string; interactionId: string }): any => {
    const leg = payment.transactions.find(
      (t: any) => t.type === reserved.type && t.interactionId === reserved.interactionId,
    );
    if (!leg) {
      throw new ReservedLegMissing(payment.id, reserved.interactionId);
    }
    return leg;
  };

  const applyTransaction = (draft: any): void => {
    // The SDK matches only on a draft that carries a PSP identifier; ours always does.
    const existing = draft.interactionId
      ? payment.transactions.find((leg: any) => leg.type === draft.type && leg.interactionId === draft.interactionId)
      : undefined;

    if (!existing) {
      sequence += 1;
      payment.transactions.push({ id: `tx-${sequence}`, ...draft });
      return;
    }
    if (existing.state !== draft.state && ALLOWED_TRANSITIONS[existing.state]?.includes(draft.state)) {
      existing.state = draft.state;
    }
  };

  const port: any = {
    create: jest.fn(async () => payment),
    update: jest.fn(async (args: any) => {
      if (args.transaction) {
        applyTransaction(args.transaction);
      }
      return payment;
    }),
    get: jest.fn(async () => payment),
    findByMerchantReference: jest.fn(async () => payment),
    setReviewFlag: jest.fn(async () => undefined),
    setStatus: jest.fn(async () => undefined),
    // The reservation trio, with the property the whole write-ahead design rests on: a reservation posted
    // under a version something else has already moved is REFUSED — the loser of the race never proceeds.
    reserve: jest.fn(async (args: any) => {
      if (args.version !== payment.version) {
        throw new PaymentVersionConflict(payment.id, args.version);
      }
      sequence += 1;
      payment.transactions.push({ id: `tx-${sequence}`, state: 'Pending', ...args.transaction });
      payment.version += 1;
    }),
    settle: jest.fn(async (_id: string, reserved: any, settlement: any) => {
      const leg = legBy(reserved);
      // The settling webhook can beat the vendor's answer back to us: unable to find our leg (still keyed on
      // the reservation id), it APPENDED its own, already carrying the operation id. Stamping that id onto
      // ours would leave two legs sharing it, which POISONS the SDK's consolidation forever — so the
      // repository releases the phantom instead of stamping it into a twin. What is asked for is not what
      // gets written, and a settle's caller may not assume otherwise.
      //
      // The twin is TYPE + `interactionId`, exactly as the SDK's `findMatchingTransactions` matches: a leg of
      // another type may legitimately hold this id (a cancel's operation id IS the vendor payment id the
      // Authorization leg carries), and releasing against it would void the record of money that moved.
      const alreadyReflected = payment.transactions.some(
        (t: any) => t !== leg && t.type === leg.type && t.interactionId === settlement.providerOperationId,
      );

      leg.state = alreadyReflected ? 'Failure' : settlement.state;
      if (!alreadyReflected) {
        leg.interactionId = settlement.providerOperationId;
      }
      payment.version += 1;
    }),
    release: jest.fn(async (_id: string, reserved: any) => {
      legBy(reserved).state = 'Failure';
      payment.version += 1;
    }),
    hasTransactionInState: jest.fn((args: any) =>
      payment.transactions.some((leg: any) => leg.type === args.transactionType && args.states.includes(leg.state)),
    ),
  };

  return { current: () => payment, port: port as CorePorts['paymentStore'] };
}
