/**
 * The write-ahead RESERVATION on the Merchant Center intent route (`POST /operations/payments/:id/intents`).
 *
 * The headroom guard reads a SNAPSHOT, so two requests that loaded the same payment both see the same money
 * as available and both pass it. What separates them is the WRITE: the operation's leg is posted before the
 * vendor is called, under the version the guard judged — so the second one is refused by commercetools and
 * never reaches the vendor. These specs drive the real route, the real orchestration and a payment store
 * that enforces the version CAS, because the property under test is a write→read loop; two mutually-mocked
 * halves would agree with each other and prove nothing.
 *
 * The three outcomes of a vendor call, and what each one owes the headroom:
 * - it ANSWERS       → the leg is settled in place and stamped with the vendor's operation id;
 * - it REFUSES       → the leg is released, the headroom comes back, a corrected retry can go out;
 * - we never LEARN   → the leg STANDS. The headroom stays closed, because the refund may well have happened.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { PaymentState, ProviderError } from '../src/domain';
import type { ProviderModule } from '../src/application/handlers';
import type { OrchestrationEnv } from '../src/application/orchestration';
import { paymentAmounts } from '../src/application/orchestration';
import { isMintedOperationReference } from '../src/domain';
import type { StoreAuthorizationDeps } from '../src/infrastructure/http/authorization/store-authorization';
import {
  makeFakeEnv,
  makeFakePorts,
  makeFakeProviderModule,
  unnamedOperationResult,
} from './support/fake-provider-module';
import { statefulPaymentStore, type StatefulPaymentStore } from './support/in-memory-payment-store';
import { buildOperationsApp, manageHeaders } from './support/operations-app';
import {
  cancelIntent,
  captureIntent,
  eur,
  leg,
  ownedPayment,
  refundIntent,
  VENDOR_PAYMENT_ID,
} from './support/payment-fixtures';

/** A vendor failure as the PROVIDER raises it — the typed error the core classifies its outcome from. */
class FakeVendorError extends ProviderError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
  }
}

/** A connector payment: 1000 authorized and settled — 1000 refundable, nothing left to capture. */
const capturedPayment = (): any =>
  ownedPayment([leg('Authorization', 'Success', 1000), leg('Charge', 'Success', 1000)]);

/** A connector payment: 1000 authorized, nothing captured — 1000 capturable, and cancellable. */
const authorizedPayment = (): any => ownedPayment([leg('Authorization', 'Success', 1000)]);

describe('POST /operations/payments/:id/intents — the write-ahead reservation', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ProviderModule;
  let store: StatefulPaymentStore;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;
  let env: OrchestrationEnv;
  let app: FastifyInstance;

  const vendorAccepts = (state: PaymentState): void => {
    provider.mapProviderStatus = jest.fn<ProviderModule['mapProviderStatus']>().mockReturnValue(state);
  };

  /** The vendor rejects the call with a typed error carrying `statusCode` — its refusal, or its outage. */
  const vendorRefundThrows = (message: string, statusCode: number): void => {
    provider.modifications.refund = jest.fn<ProviderModule['modifications']['refund']>(async () => {
      throw new FakeVendorError(message, statusCode);
    });
  };

  const post = (url: string, payload: object): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url, payload, headers: manageHeaders });

  const intent = (payload: object): Promise<LightMyRequestResponse> =>
    post('/operations/payments/pay-1/intents', payload);

  const legsOfType = (type: string): any[] => store.current().transactions.filter((t: any) => t.type === type);

  beforeEach(async () => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    store = statefulPaymentStore(capturedPayment());
    ports.paymentStore = store.port;
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(true);
    env = makeFakeEnv();
    app = await buildOperationsApp({ ports, provider, storeExists, env });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('the race — two intents that read the same payment version', () => {
    test('the loser is refused 409 and NEVER reaches the vendor', async () => {
      vendorAccepts(PaymentState.REFUND_REQUESTED);
      // Both operators loaded the payment before either acted: same version, same 1000 refundable, so both
      // pass the guard. Only the reservation can tell them apart.
      const asLoaded = structuredClone(store.current());
      store.port.get = jest.fn<typeof store.port.get>().mockResolvedValue(asLoaded);

      const [first, second] = await Promise.all([intent(refundIntent(1000)), intent(refundIntent(1000))]);

      expect([first.statusCode, second.statusCode].sort()).toStrictEqual([200, 409]);
      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
      expect(legsOfType('Refund')).toHaveLength(1);
    });

    test('the 409 tells the operator what to do, and nothing else', async () => {
      const asLoaded = structuredClone(store.current());
      store.port.get = jest.fn<typeof store.port.get>().mockResolvedValue(asLoaded);
      await intent(refundIntent(1000));

      const conflict = await intent(refundIntent(1000));

      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toStrictEqual({
        message: expect.stringMatching(/changed.*Reload the payment and try again\./),
        statusCode: 409,
        errors: [{ code: 'ConcurrentModification', message: expect.any(String) }],
      });
    });
  });

  /**
   * ONE merchant refund, SEVERAL vendor operations. Unzer cancels against a charge and only down to what
   * that charge still holds, so 900 over two captures of 500 is 500 off one and 400 off the other — two
   * calls, two vendor ids, and therefore two commercetools legs. One leg of 900 could name at most one of
   * those ids, and the settling notifications for the others would match nothing and append their own.
   *
   * The walk is what these pin: each step reserves under the version the PREVIOUS step's leg bumped, so a
   * step reading a stale version would lose the CAS and abort a refund whose earlier slices already moved
   * real money.
   */
  describe('a refund the vendor splits across several charges', () => {
    /** The provider resolves the refund to two calls, and names a distinct operation for each. */
    const vendorSplits = (): void => {
      provider.modifications.planRefund = jest.fn<ProviderModule['modifications']['planRefund']>().mockResolvedValue([
        { amount: eur(500), targetOperationId: 'c1' },
        { amount: eur(400), targetOperationId: 'c2' },
      ]);
      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockImplementation(async (_cfg, req) => ({
          providerOperationId: `${req.targetOperationId}.s-cnl-1`,
          rawStatus: { state: 'REFUND_REQUESTED' },
        }));
    };

    beforeEach(() => {
      vendorAccepts(PaymentState.REFUND_REQUESTED);
      vendorSplits();
    });

    test('becomes one leg per charge, each under its own vendor identity', async () => {
      const res = await intent(refundIntent(900));

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.refund).toHaveBeenCalledTimes(2);
      // Two legs, two amounts, two ids. The ids are CHARGE-SCOPED: Unzer numbers a cancellation within its
      // parent, so both slices come back as `s-cnl-1` and bare ids would collide into one.
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ amount: eur(500), interactionId: 'c1.s-cnl-1' }),
        expect.objectContaining({ amount: eur(400), interactionId: 'c2.s-cnl-1' }),
      ]);
    });

    test('each slice reserves under the version the previous slice bumped', async () => {
      await intent(refundIntent(900));

      const versions = jest.mocked(store.port.reserve).mock.calls.map(([reservation]) => reservation.version);

      expect(versions).toHaveLength(2);
      expect(versions[1]).toBeGreaterThan(versions[0]);
    });

    test('every slice is sent to the vendor under a name of its own', async () => {
      await intent(refundIntent(900));

      const names = jest.mocked(provider.modifications.refund).mock.calls.map(([, req]) => req.operationReference);

      // Distinct, and each is the name its own leg was reserved under - a shared name would make the two
      // slices one operation to every reader downstream.
      expect(new Set(names).size).toBe(2);
      expect(names).toStrictEqual(
        jest.mocked(store.port.reserve).mock.calls.map(([reservation]) => reservation.transaction.interactionId),
      );
    });

    // A slice that fails AFTER an earlier one moved money is not a failed refund - part of it is done, and
    // the legs already written are the record of it. What must not happen is the earlier slices being
    // rolled back or their legs disappearing.
    test('a later slice failing leaves the earlier slice settled', async () => {
      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockImplementationOnce(async (_cfg, req) => ({
          providerOperationId: `${req.targetOperationId}.s-cnl-1`,
          rawStatus: { state: 'REFUND_REQUESTED' },
        }))
        .mockImplementationOnce(async () => {
          throw new FakeVendorError('Charge cannot be cancelled.', 400);
        });

      const res = await intent(refundIntent(900));

      expect(res.statusCode).toBe(400);
      // The first slice STANDS - its money moved and its leg keeps the vendor's id for the settling
      // notification. The second is released as a `Failure`, so the headroom it reserved comes back and
      // the refusal stays on the payment's own record rather than vanishing with the response.
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ amount: eur(500), interactionId: 'c1.s-cnl-1', state: 'Pending' }),
        expect.objectContaining({ amount: eur(400), state: 'Failure' }),
      ]);
    });
  });

  describe('the vendor answers — the reserved leg is settled in place', () => {
    test('an accepted refund settles the leg it reserved and stamps the vendor operation id onto it', async () => {
      vendorAccepts(PaymentState.REFUND_REQUESTED);

      const res = await intent(refundIntent(400));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'received' });
      // ONE leg — the reserved one, now carrying the vendor's operation id, which is the only key the
      // settling webhook can find it by.
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ type: 'Refund', state: 'Pending', amount: eur(400), interactionId: 'ref-1' }),
      ]);
      // The leg was written AHEAD of the vendor call, so nothing appends a second one afterwards.
      expect(store.port.update).not.toHaveBeenCalled();
    });

    test('the reservation, the vendor and the settlement all speak the SAME name for the operation', async () => {
      vendorAccepts(PaymentState.REFUND_REQUESTED);

      await intent(refundIntent(400));

      const reserved = jest.mocked(store.port.reserve).mock.calls[0][0];
      const [, toldTheVendor] = jest.mocked(provider.modifications.refund).mock.calls[0];
      const [, settled, settlement] = jest.mocked(store.port.settle).mock.calls[0];

      // Reserve under X, tell the vendor the operation is named X, reconcile by X — anything else and an
      // outcome we never learn can never be matched back to the leg that is holding the money. The leg is
      // settled by the same HANDLE it was reserved under: its type and that name.
      expect(toldTheVendor.operationReference).toBe(reserved.transaction.interactionId);
      expect(settled).toStrictEqual({
        type: reserved.transaction.type,
        interactionId: reserved.transaction.interactionId,
      });
      expect(settlement).toStrictEqual({ state: 'Pending', providerOperationId: 'ref-1' });
    });
  });

  /**
   * The vendor performed the operation and NAMED nothing — no operation id at all. It is a legal answer
   * (`CaptureResponse.id` / `RefundResponse.id` are optional in the SDK, and the handler passes the absence
   * through rather than inventing an id), and it leaves the settle with nothing to re-key the leg to.
   *
   * The leg is therefore NOT settled. A leg moved to `Success` under our own reservation name is one the
   * settling webhook cannot find — it dedupes on the vendor's operation id and the vendor's payment id, and
   * the leg carries neither — so it would APPEND its own leg beside ours and the same money would be counted
   * twice (proven end to end in `payment-reservation-consolidation.spec.ts`). Leaving it standing is the rule
   * the READ path already takes on this very input (`reconcile-reservations::legResolution`): the headroom
   * stays shut over money that really did move, which blocks a further modification and never duplicates one.
   */
  describe('the vendor ANSWERS but names no operation', () => {
    beforeEach(() => {
      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockResolvedValue(unnamedOperationResult({ status: 'REFUNDED' }));
      vendorAccepts(PaymentState.REFUNDED);
    });

    test('the leg is not settled — it stands under the name that can still find it', async () => {
      const res = await intent(refundIntent(400));

      // The vendor answered, and the operator is told what it said: the refund went through.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'approved' });
      expect(store.port.settle).not.toHaveBeenCalled();
      // Nor is a second leg appended: the reservation's leg is the only one, exactly as reserved.
      expect(store.port.update).not.toHaveBeenCalled();
      const reserved = jest.mocked(store.port.reserve).mock.calls[0][0].transaction;
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({
          type: 'Refund',
          state: 'Pending',
          amount: eur(400),
          interactionId: reserved.interactionId,
        }),
      ]);
    });

    test('the headroom stays SHUT — the money the vendor moved is not offered a second time', async () => {
      await intent(refundIntent(400));

      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(600));
      // The 400 is SPOKEN FOR, not given back: the leg stands Pending, which is both why the headroom is
      // shut and how the settling webhook still finds the leg to flip.
      expect(legsOfType('Refund')).toStrictEqual([expect.objectContaining({ state: 'Pending', amount: eur(400) })]);
    });

    test('the standing leg is logged as its OWN fault, naming the leg the runbook needs', async () => {
      await intent(refundIntent(400));

      // A vendor that cannot name an operation it performed fences money off until a human clears the leg
      // by hand, so it is logged with the two fields that reconciliation needs.
      expect(env.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('without naming the operation'),
        expect.objectContaining({
          paymentId: 'pay-1',
          transactionType: 'Refund',
          interactionId: expect.any(String),
        }),
      );
    });
  });

  /**
   * A cancel names no operation of its own at the vendor. the vendor's `CancelPaymentResponse` is
   * `{ payment }`, so the operation id the core settles the leg with IS the vendor PAYMENT id — the same
   * string `create-payment.ts` already stamped on the Authorization leg's `interactionId`.
   *
   * So the settle's duplicate guard sees a leg carrying "its" id and must NOT read it as a twin: that leg is
   * an `Authorization`, and only two legs of the SAME TYPE can poison the SDK's consolidation. Read
   * type-blind, the guard inverts a cancel the vendor PERFORMED into `CancelAuthorization: Failure`, hands
   * the whole authorized amount back as capturable, and the panel offers Capture on a voided authorization.
   */
  describe('the vendor CANCELS — its operation id is the payment id the Authorization leg already carries', () => {
    beforeEach(() => {
      store = statefulPaymentStore(authorizedPayment());
      ports.paymentStore = store.port;
      vendorAccepts(PaymentState.CANCELLED);
    });

    test('the reserved leg settles to Success — never released against the Authorization leg', async () => {
      const res = await intent(cancelIntent);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'approved' });
      expect(legsOfType('CancelAuthorization')).toStrictEqual([
        expect.objectContaining({
          type: 'CancelAuthorization',
          state: 'Success',
          amount: eur(1000),
          interactionId: 'vendor-pay-1',
        }),
      ]);
    });

    test('the voided money is GONE from the headroom — no Capture, no second Cancel', async () => {
      await intent(cancelIntent);

      expect(paymentAmounts(store.current()).capturable).toStrictEqual(eur(0));
      // The panel reads its affordances off that headroom; a second intent finds nothing left to move.
      const second = await intent(cancelIntent);
      expect(second.statusCode).toBe(400);
      expect(provider.modifications.cancel).toHaveBeenCalledTimes(1);
    });
  });

  // The most common decline is not a thrown 4xx at all: the vendor answers 200 and puts `REJECTED` in the
  // body. It runs the ACCEPTED path — the state machine maps it to a Failure leg — so the release has to
  // come from there too, or a declined refund would hold the headroom shut forever.
  describe('the vendor DECLINES in a 2xx body', () => {
    beforeEach(() => {
      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockResolvedValue({ providerOperationId: 'ref-1', rawStatus: { state: 'FAILED' } });
      vendorAccepts(PaymentState.FAILED);
    });

    test('the reserved leg ends in Failure and the headroom comes back whole', async () => {
      const res = await intent(refundIntent(1000));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'rejected' });
      // ONE leg — the reserved one, failed in place. A second (appended) leg would count the refused money
      // against the headroom for good.
      expect(legsOfType('Refund')).toStrictEqual([expect.objectContaining({ type: 'Refund', state: 'Failure' })]);
      expect(store.port.update).not.toHaveBeenCalled();
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(1000));
      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
    });

    /**
     * The same compensation, the same two faults — and this is the branch the operator actually meets, because
     * a 2xx `REJECTED` is the vendor's ordinary decline. It must therefore fail EXACTLY as the thrown-4xx branch
     * does: the vendor's answer still reaches the caller, and the leg left standing is logged under the one
     * message the runbook greps for, naming the leg its steps are driven by. An operator cannot be expected to
     * know which internal path wedged their payment.
     */
    describe('whose compensating release FAILS', () => {
      beforeEach(() => {
        store.port.release = jest.fn<typeof store.port.release>(async () => {
          throw new Error('commercetools is unavailable');
        });
      });

      test('the operator still gets the VENDOR’s outcome — the refusal is the truth about the money', async () => {
        const res = await intent(refundIntent(1000));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toStrictEqual({ outcome: 'rejected' });
      });

      test('the standing leg is logged as its OWN fault, naming the leg the runbook needs', async () => {
        await intent(refundIntent(1000));

        expect(env.logger.error).toHaveBeenCalledWith(
          expect.stringContaining('could not be released'),
          expect.objectContaining({
            paymentId: 'pay-1',
            transactionType: 'Refund',
            interactionId: expect.any(String),
            error: 'commercetools is unavailable',
          }),
        );
        expect(legsOfType('Refund')).toStrictEqual([
          expect.objectContaining({ type: 'Refund', state: 'Pending', amount: eur(1000) }),
        ]);
        expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(0));
      });
    });
  });

  // The reservation is the LAST thing before the vendor call. Anything the request still needs — the store
  // config above all — is fetched BEFORE it, so a failure that never reached the vendor cannot leave a leg
  // holding money that never moved. It could not even be reconciled: reconciliation reads the payment's
  // details through the very config that just failed.
  describe('a failure BEFORE the vendor call fences off nothing', () => {
    test('an unresolvable store config writes no leg, and the headroom is untouched', async () => {
      ports.configResolver.resolve = jest
        .fn<typeof ports.configResolver.resolve>()
        .mockRejectedValue(new Error('the store config could not be read'));

      const res = await intent(refundIntent(1000));

      expect(res.statusCode).toBe(500);
      expect(store.port.reserve).not.toHaveBeenCalled();
      expect(legsOfType('Refund')).toStrictEqual([]);
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(1000));
      expect(provider.modifications.refund).not.toHaveBeenCalled();
    });
  });

  describe('the AMBIGUOUS outcome — we never learned whether the money moved', () => {
    beforeEach(() => {
      // A transport failure: the request went out, the answer never came back. The vendor may have refunded.
      vendorRefundThrows('PSP request failed: socket hang up', 502);
    });

    test('the reservation STANDS — the leg is still there, still holding the money it was reserved for', async () => {
      const res = await intent(refundIntent(1000));

      expect(res.statusCode).toBe(500);
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ type: 'Refund', state: 'Pending', amount: eur(1000) }),
      ]);
      expect(store.port.release).not.toHaveBeenCalled();
    });

    test('the headroom stays CLOSED — an immediate second identical intent is rejected 400, unsent', async () => {
      await intent(refundIntent(1000));
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(0));

      const second = await intent(refundIntent(1000));

      expect(second.statusCode).toBe(400);
      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
    });
  });

  describe('the DEFINITE refusal — the vendor answered "no"', () => {
    test('the leg is released, the headroom returns, and a corrected retry goes out', async () => {
      vendorRefundThrows('amount exceeds the refundable balance', 400);

      const refused = await intent(refundIntent(1000));

      // The vendor ANSWERED, so the operator is told what it said and why — a 500 would read as "the
      // connector is broken" and hide the reason among the outages in the error log.
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toStrictEqual({
        message: 'amount exceeds the refundable balance',
        statusCode: 400,
        errors: [
          {
            code: 'ProviderRefusedOperation',
            message: 'amount exceeds the refundable balance',
          },
        ],
      });
      expect(legsOfType('Refund')).toStrictEqual([expect.objectContaining({ type: 'Refund', state: 'Failure' })]);
      // Nothing was moved, so nothing is spoken for: the money is available again.
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(1000));

      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockResolvedValue({ providerOperationId: 'ref-9', rawStatus: { state: 'REFUNDED' } });
      vendorAccepts(PaymentState.REFUNDED);

      const retry = await intent(refundIntent(600));

      expect(retry.statusCode).toBe(200);
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ state: 'Failure' }),
        expect.objectContaining({ state: 'Success', amount: eur(600), interactionId: 'ref-9' }),
      ]);
    });

    test('the retry is a NEW operation to the vendor — it is not deduplicated against the refused one', async () => {
      vendorRefundThrows('amount exceeds the refundable balance', 400);
      await intent(refundIntent(1000));
      vendorAccepts(PaymentState.REFUNDED);
      provider.modifications.refund = jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockResolvedValue({ providerOperationId: 'ref-9', rawStatus: { state: 'REFUNDED' } });

      await intent(refundIntent(600));

      const released = jest.mocked(store.port.release).mock.calls[0][1];
      const [, retried] = jest.mocked(provider.modifications.refund).mock.calls[0];
      expect(retried.operationReference).not.toBe(released);
    });
  });

  /**
   * The release that hands the refused money back is itself a commercetools WRITE, and a write can fail — a
   * 503, or three lost CAS rounds. Two faults then stand at once, and they must not be told as one:
   *
   * - the vendor's refusal is still the whole truth about the MONEY (it answered, it moved nothing), so it is
   *   what the operator is answered with — a 500 in its place would read as "the connector is broken", bury
   *   the reason the vendor gave, and invite a retry of a call that will be refused again;
   * - the leg that stayed behind is a SECOND, independent fault: it holds the refund headroom shut over money
   *   that provably never moved, and reconciliation cannot open it (it settles only what the vendor REPORTS,
   *   and a refusal is not an operation the vendor holds). Only a human clears it, so it is logged as the
   *   fault it is — a compensation that fails invisibly is how a payment wedges with nobody knowing.
   */
  describe('the DEFINITE refusal whose compensating release FAILS', () => {
    beforeEach(() => {
      vendorRefundThrows('amount exceeds the refundable balance', 400);
      store.port.release = jest.fn<typeof store.port.release>(async () => {
        throw new Error('commercetools is unavailable');
      });
    });

    test('the operator still gets the VENDOR’s answer — its status and its reason, not a 500', async () => {
      const refused = await intent(refundIntent(1000));

      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toStrictEqual({
        message: 'amount exceeds the refundable balance',
        statusCode: 400,
        errors: [
          {
            code: 'ProviderRefusedOperation',
            message: 'amount exceeds the refundable balance',
          },
        ],
      });
    });

    test('the standing leg is logged as its OWN fault, naming the leg the runbook needs', async () => {
      await intent(refundIntent(1000));

      expect(env.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('could not be released'),
        expect.objectContaining({
          paymentId: 'pay-1',
          transactionType: 'Refund',
          interactionId: expect.any(String),
          error: 'commercetools is unavailable',
        }),
      );
      // And it really is standing: the Pending leg holds the headroom shut over money that never moved.
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ type: 'Refund', state: 'Pending', amount: eur(1000) }),
      ]);
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(0));
    });

    test('a release that SUCCEEDS is not a fault — the leg goes, the headroom returns, nothing is logged', async () => {
      // The same refusal against a store whose release works: the compensation is the ONLY difference.
      store = statefulPaymentStore(capturedPayment());
      ports.paymentStore = store.port;

      const refused = await intent(refundIntent(1000));

      expect(refused.statusCode).toBe(400);
      expect(legsOfType('Refund')).toStrictEqual([expect.objectContaining({ type: 'Refund', state: 'Failure' })]);
      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(1000));
      expect(env.logger.error).not.toHaveBeenCalled();
    });
  });

  // The certified Checkout contract (OAuth2). It reserves NOTHING: its caller may legitimately act while the
  // CT transactions lag the PSP, so there is no headroom here to hold. It still NAMES its operation — which
  // is what buys it the vendor's idempotency for free.
  describe('the Checkout route reserves nothing', () => {
    test('an over-amount capture still reaches the vendor, unreserved and unguarded — and still named', async () => {
      vendorAccepts(PaymentState.CAPTURED);

      const res = await post('/operations/payment-intents/pay-1', captureIntent(1500));

      expect(res.statusCode).toBe(200);
      expect(store.port.reserve).not.toHaveBeenCalled();
      expect(store.port.settle).not.toHaveBeenCalled();
      const [, toldTheVendor] = jest.mocked(provider.modifications.capture).mock.calls[0];
      expect(toldTheVendor.operationReference).toEqual(expect.any(String));
      // Its leg is APPENDED once the vendor has answered, exactly as it always was.
      expect(store.port.update).toHaveBeenCalledTimes(1);
    });

    /**
     * The unnamed vendor answer obeys the SAME rule here as on the reserved path — it just has to append the
     * leg instead of settling one.
     *
     * The vendor PAYMENT id may not key it. That id names the payment, not the operation, so two unnamed
     * operations of one type collide on it, and the SDK's single-match consolidation advances the first leg's
     * state and id while never touching its AMOUNT — so the second operation's money is recorded nowhere and
     * the headroom offers money that is already gone (`payment-reservation-consolidation.spec.ts` drives that
     * against the REAL SDK). The leg is therefore keyed on the name WE minted, which is unique per operation
     * because it is the vendor's own idempotency key — and left `Pending`, so the settling webhook's leg is
     * the one record of the money.
     */
    test('an unnamed vendor answer lands a PENDING leg keyed on our minted name — never on the vendor payment id', async () => {
      provider.modifications.capture = jest
        .fn<ProviderModule['modifications']['capture']>()
        .mockResolvedValue(unnamedOperationResult({ status: 'CAPTURED' }));
      vendorAccepts(PaymentState.CAPTURED);

      const res = await post('/operations/payment-intents/pay-1', captureIntent(1000));

      // The HTTP contract is untouched: the vendor captured, and the certified caller is told so.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'approved' });
      expect(store.port.settle).not.toHaveBeenCalled();

      const { transaction } = jest.mocked(store.port.update).mock.calls[0][0] as any;
      expect(transaction).toMatchObject({ type: 'Charge', state: 'Pending' });
      expect(transaction.interactionId).not.toBe(VENDOR_PAYMENT_ID);
      expect(isMintedOperationReference('psp', 'pay-1', 'Charge', transaction.interactionId)).toBe(true);
    });
  });
});
