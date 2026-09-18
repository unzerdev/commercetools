/**
 * Webhook REPLAY integration tests: route-level `app.inject` against the
 * production wiring (error handler + raw-body parser + `webhookRoutes`) with the REAL capability-URL
 * token functions (`webhookUrlToken` mints the path segment, `verifyWebhookUrlToken` gates it) and
 * the REAL `PspWebhookHandler` + provider `mapProviderStatus` — only the CorePorts and the Unzer
 * `getPayment` transport are fakes, made STATEFUL where replay semantics need memory: the marker
 * store is a real in-memory Set (claim = add-if-absent, release = delete) and `update` records the
 * transactions it writes so consecutive deliveries observe each other exactly as redeliveries
 * against live commercetools would.
 *
 * An Unzer webhook body carries only the event name + a resource URL / payment id, so the handler
 * reads the AUTHORITATIVE state once via `getPayment` and reconciles by the merchant reference that
 * payment echoes. Pinned contract: a duplicate delivery of one envelope → processed then
 * marker-duplicate, ONE update; a settlement arriving before the CT Payment exists → ignored + marker
 * RELEASED so the identical redelivery claims again and processes once the payment exists, while a
 * settlement already reflected by the sync/return leg (`interactionId` = vendor paymentId) is
 * transaction-guard-deduped (marker kept); a wrong token → 401 with no read, no claim, no update, and
 * the tokenless path 404s; a rejected settlement records the Failure transaction typed by the
 * per-kind map; a refund (whose Unzer notification names the parent payment) reconciles by the echoed
 * merchant reference; and an event admitted under a DIFFERENT store's own token never reconciles onto
 * this store's payment.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CorePorts } from '../src/application/ports';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { verifyWebhookUrlToken, webhookUrlToken } from '../src/infrastructure/crypto/crypto';
import { registerRawBodyParser } from '../src/infrastructure/http/server/server';
import { webhookRoutes } from '../src/infrastructure/http/routes/vendor/webhook.route';
import { PspWebhookHandler } from '../src/providers/psp/webhook/webhook.handler';
import type { PspClient, PspConnectionConfig, UnzerPayment } from '../src/providers/psp/client';
import { mapProviderStatus } from '../src/providers/psp/status';
import {
  assertCtCustomObjectKey,
  fakePayment,
  makeFakeEnv,
  makeFakePorts,
  makeFakeProviderModule,
} from './support/fake-provider-module';
import { useEncryptionKeyring } from './support/webhook-token';

// The test keyring the REAL token functions derive from (a 64-hex value is used verbatim as the
// 32 raw key bytes) — pinned and restored around the suite so no ambient key leaks between suites.
useEncryptionKeyring('c'.repeat(64));

/** A recorded CT Transaction, as the payment's own transaction history replays it to the guard. */
interface RecordedTransaction {
  type: string;
  state: string;
  interactionId?: string;
}

/** The merchant reference every authoritative payment echoes (`paymentReference`), the reconcile key. */
const MERCHANT_REF = 'ref-1';

/** The vendor payment id the notifications name and the authoritative reads return. */
const VENDOR_PAY = 'vendor-pay-1';

/** The store the harness payment belongs to — the reconcile lookup is scoped to it. */
const STORE_KEY = 'store-1';

/** A minimal Unzer webhook envelope: the event name + the resource URL / payment id, never the state. */
const envelope = (o: { event?: string; paymentId?: string; opId?: string; resource?: string } = {}): string => {
  const paymentId = o.paymentId ?? VENDOR_PAY;
  return JSON.stringify({
    event: o.event ?? 'charge.succeeded',
    publicKey: 's-pub-test',
    paymentId,
    retrieveUrl: `https://sbx-api.unzer.com/v1/payments/${paymentId}/${o.resource ?? 'charges'}/${o.opId ?? 'op-1'}`,
  });
};

/**
 * A faked `getPayment` returning the authoritative payment (coarse state + echoed merchant reference +
 * the transaction legs). The legs are load-bearing twice over: a case may need the interpreter to read a
 * per-leg outcome (a refused charge whose leg carries `status: 'error'`), and EVERY case needs the leg the
 * notification points at, because the operation identity the reconciler records is read off that leg's own
 * `url` — a payment with no leg of the event's kind settles nothing at all. The default is
 * therefore the `charges/op-1` leg the default envelope names.
 */
const fakeGetPayment = (
  stateName: string,
  ref: string = MERCHANT_REF,
  id: string = VENDOR_PAY,
  transactions: UnzerPayment['transactions'] = [
    { type: 'charge', status: 'success', url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/op-1` },
  ],
) =>
  jest.fn<(cfg: PspConnectionConfig, paymentId: string) => Promise<UnzerPayment>>().mockResolvedValue({
    id,
    state: { id: 1, name: stateName },
    paymentReference: ref,
    transactions,
  });

/**
 * Stateful replay harness over `makeFakePorts()` (local overrides only): a real Set-backed marker
 * store, a `findByMerchantReference` that honours whether the CT Payment exists yet (out-of-order
 * legs) and matches the reconcile anchor + store, and an `update` that records each Transaction onto
 * the payment's OWN `transactions` history — the orchestration's per-operation duplicate guard reads
 * that history exactly as it would on a live CT Payment. `seedTransactions` pre-loads history the
 * sync/return leg would have written before the webhook arrives.
 */
function makeReplayHarness(opts: { paymentExists?: boolean; seedTransactions?: RecordedTransaction[] } = {}) {
  const markers = new Set<string>();
  const updates: Array<Parameters<CorePorts['paymentStore']['update']>[0]> = [];
  const payment = fakePayment({ transactions: [...(opts.seedTransactions ?? [])] });
  let paymentExists = opts.paymentExists ?? true;

  const ports = makeFakePorts();
  ports.markerStore.claim = jest.fn<CorePorts['markerStore']['claim']>().mockImplementation(async (key) => {
    // Same platform contract the real store hits: an out-of-charset key must fail HERE, not in
    // production — this harness replaces the guarded fake, so it re-asserts the guard itself.
    assertCtCustomObjectKey(key);
    if (markers.has(key)) {
      return false;
    }
    markers.add(key);
    return true;
  });
  ports.markerStore.release = jest.fn<CorePorts['markerStore']['release']>().mockImplementation(async (key) => {
    markers.delete(key);
  });
  ports.paymentStore.findByMerchantReference = jest
    .fn<CorePorts['paymentStore']['findByMerchantReference']>()
    // Store-scoped like the real query: a match requires BOTH the reference and the store.
    .mockImplementation(async (ref, storeKey) =>
      paymentExists && ref === MERCHANT_REF && storeKey === STORE_KEY ? payment : undefined,
    );
  ports.paymentStore.update = jest.fn<CorePorts['paymentStore']['update']>().mockImplementation(async (args) => {
    updates.push(args);
    if (args.transaction) {
      payment.transactions.push({
        type: args.transaction.type,
        state: args.transaction.state,
        interactionId: args.transaction.interactionId,
      });
    }
    return payment;
  });

  return {
    ports,
    markers,
    updates,
    /** Flip the out-of-order leg: the CT Payment now exists for `findByMerchantReference`. */
    createPayment: () => {
      paymentExists = true;
    },
  };
}

describe('webhook replay (integration: real token gate + the real provider parse/status-map)', () => {
  let fastify: FastifyInstance;

  /** The production route wiring with the REAL provider webhook surface + status map over fake ports. */
  async function buildApp(
    ports: CorePorts,
    getPayment: jest.Mock<(cfg: PspConnectionConfig, paymentId: string) => Promise<UnzerPayment>>,
  ): Promise<void> {
    const provider = makeFakeProviderModule();
    provider.webhook = new PspWebhookHandler({
      payments: { get: getPayment } as unknown as PspClient['payments'],
      webhooks: {
        register: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
        delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as unknown as PspClient['webhooks'],
    });
    provider.mapProviderStatus = mapProviderStatus;
    // The REAL token check replaces the fake's always-true stub, so a wrong token really fails here.
    ports.crypto.verifyWebhookUrlToken = jest
      .fn<CorePorts['crypto']['verifyWebhookUrlToken']>()
      .mockImplementation(verifyWebhookUrlToken);
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    registerRawBodyParser(fastify);
    await fastify.register(webhookRoutes, { ports, provider, env: makeFakeEnv() });
    await fastify.ready();
  }

  /** POST the payload to the store's capability URL — its own derived token unless a test forges one. */
  function inject(payload: string, storeKey: string = STORE_KEY, token: string = webhookUrlToken(storeKey)) {
    return fastify.inject({
      method: 'POST',
      url: `/webhooks/${storeKey}/${token}`,
      headers: { 'content-type': 'application/json' },
      payload,
    });
  }

  afterEach(async () => {
    await fastify.close();
  });

  describe('duplicate delivery', () => {
    test('the same captured envelope twice → processed then duplicate, exactly one update', async () => {
      const h = makeReplayHarness();
      const getPayment = fakeGetPayment('completed');
      await buildApp(h.ports, getPayment);
      const payload = envelope({ event: 'charge.succeeded', opId: 'op-1' });

      const first = await inject(payload);

      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ outcome: 'processed' });
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toEqual(
        expect.objectContaining({
          id: 'pay-1',
          pspReference: VENDOR_PAY,
          transaction: expect.objectContaining({
            type: 'Charge',
            state: 'Success',
            amount: expect.objectContaining({ centAmount: 1500, currencyCode: 'EUR' }),
            interactionId: 'op-1',
          }),
        }),
      );
      // The marker key is the COMPOSITE operation identity, never the native event id.
      expect(h.markers.has('vendor-pay-1~payment.captured~op-1')).toBe(true);

      const second = await inject(payload);

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ outcome: 'duplicate' });
      expect(h.updates).toHaveLength(1);
      // The authoritative state is read once per delivery (no N+1): two deliveries, two reads.
      expect(getPayment).toHaveBeenCalledTimes(2);
    });
  });

  describe('out-of-order delivery', () => {
    test('settlement before the CT Payment exists → ignored + marker released; the identical redelivery claims again and processes; a third delivery is marker-deduped', async () => {
      const h = makeReplayHarness({ paymentExists: false });
      await buildApp(h.ports, fakeGetPayment('completed'));
      const payload = envelope({ event: 'charge.succeeded', opId: 'op-1' });

      // Leg 1: lookup miss — no CT Payment yet. Deliberate 200 no-op, marker RELEASED so the
      // vendor's later redelivery can re-process once the payment exists.
      const miss = await inject(payload);
      expect(miss.statusCode).toBe(200);
      expect(miss.json()).toEqual({ outcome: 'ignored' });
      expect(h.updates).toHaveLength(0);
      expect(h.markers.size).toBe(0);

      // Leg 2: the payment now exists — the IDENTICAL delivery claims the same composite key again
      // (the release made that possible) and processes exactly once.
      h.createPayment();
      const redelivery = await inject(payload);
      expect(redelivery.json()).toEqual({ outcome: 'processed' });
      expect(h.updates).toHaveLength(1);

      // Leg 3: a further same-operation redelivery loses the marker claim — no double Transaction,
      // marker kept (the work is genuinely done).
      const third = await inject(payload);
      expect(third.json()).toEqual({ outcome: 'duplicate' });
      expect(h.updates).toHaveLength(1);
      expect(h.markers.has('vendor-pay-1~payment.captured~op-1')).toBe(true);
    });

    // A leg the vendor is still processing reflects NOTHING (`CAPTURE_REQUESTED` is a no-op state, awaiting
    // exactly this leg's settling delivery). Keeping its marker would make that settling delivery a
    // marker-duplicate and the capture would never land, so a delivery that records nothing must release.
    test('a pending leg records nothing and RELEASES its marker, so the settling delivery still processes', async () => {
      const h = makeReplayHarness();
      await buildApp(
        h.ports,
        fakeGetPayment('pending', MERCHANT_REF, VENDOR_PAY, [
          {
            type: 'charge',
            status: 'pending',
            url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/op-1`,
          },
        ]),
      );
      const payload = envelope({ event: 'charge.succeeded', opId: 'op-1' });

      const pending = await inject(payload);

      expect(pending.statusCode).toBe(200);
      expect(h.updates.filter((u) => u.transaction !== undefined)).toHaveLength(0);
      expect(h.markers.has('vendor-pay-1~payment.captured~op-1')).toBe(false);

      // The SAME leg, now settled: the marker is free, so the capture reflects.
      await fastify.close();
      await buildApp(
        h.ports,
        fakeGetPayment('completed', MERCHANT_REF, VENDOR_PAY, [
          {
            type: 'charge',
            status: 'success',
            url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/op-1`,
          },
        ]),
      );

      const settled = await inject(payload);

      expect(settled.statusCode).toBe(200);
      expect(settled.json()).toEqual({ outcome: 'processed' });
      expect(h.updates.filter((u) => u.transaction !== undefined)).toHaveLength(1);
    });

    test('a settlement already reflected by the sync/return leg (interactionId = vendor paymentId) is deduped, marker kept', async () => {
      // The return leg / sync path stamps `interactionId = providerPaymentId` on the Transaction it
      // reflects. The later webhook for the SAME settlement carries a per-operation id, so its
      // composite marker claims — the authoritative guard catches it instead: a same-type Success
      // Transaction under the vendor paymentId means this settlement is already reflected.
      const h = makeReplayHarness({
        seedTransactions: [{ type: 'Charge', state: 'Success', interactionId: VENDOR_PAY }],
      });
      await buildApp(h.ports, fakeGetPayment('completed'));

      const webhook = await inject(envelope({ event: 'charge.succeeded', opId: 'op-1' }));
      expect(webhook.statusCode).toBe(200);
      expect(webhook.json()).toEqual({ outcome: 'duplicate' });
      expect(h.updates).toHaveLength(0);
      expect(h.markers.has('vendor-pay-1~payment.captured~op-1')).toBe(true);
    });
  });

  describe('bad token (fail-closed)', () => {
    test("another store's token on this store's path → 401, no CT resolve, no read, no marker claim, no update", async () => {
      const h = makeReplayHarness();
      const getPayment = fakeGetPayment('completed');
      await buildApp(h.ports, getPayment);

      const response = await inject(
        envelope({ event: 'charge.succeeded', opId: 'op-1' }),
        STORE_KEY,
        webhookUrlToken('store-attacker'),
      );

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ outcome: 'unauthorized' });
      // Fail-closed BEFORE any I/O: neither the store config nor the authoritative state is read.
      expect(h.ports.configResolver.resolve).not.toHaveBeenCalled();
      expect(getPayment).not.toHaveBeenCalled();
      expect(h.ports.markerStore.claim).not.toHaveBeenCalled();
      expect(h.markers.size).toBe(0);
      expect(h.updates).toHaveLength(0);
    });

    test('the tokenless path → 404, no read, no marker claim, no update', async () => {
      const h = makeReplayHarness();
      const getPayment = fakeGetPayment('completed');
      await buildApp(h.ports, getPayment);

      const response = await fastify.inject({
        method: 'POST',
        url: `/webhooks/${STORE_KEY}`,
        headers: { 'content-type': 'application/json' },
        payload: envelope({ event: 'charge.succeeded', opId: 'op-1' }),
      });

      expect(response.statusCode).toBe(404);
      expect(getPayment).not.toHaveBeenCalled();
      expect(h.ports.markerStore.claim).not.toHaveBeenCalled();
      expect(h.updates).toHaveLength(0);
    });
  });

  describe('rejected settlement (failure typing)', () => {
    test('a refused charge (errored leg) under a charge event records Charge:Failure via the per-kind map, not Authorization:Failure', async () => {
      const h = makeReplayHarness();
      // A refused synchronous charge: the payment ends `canceled` and the charge leg the event points at
      // carries `status: 'error'` — the interpreter reads that leg's own outcome, not the coarse state.
      await buildApp(
        h.ports,
        fakeGetPayment('canceled', MERCHANT_REF, VENDOR_PAY, [
          { type: 'charge', status: 'error', url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/op-1` },
        ]),
      );

      const response = await inject(envelope({ event: 'charge.succeeded', opId: 'op-1' }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ outcome: 'processed' });
      // FAILED's state-machine default is Authorization:Failure; `failureTransactionType` from the
      // per-kind map (payment.captured → Charge) retypes the in-flight operation's failure.
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toEqual(
        expect.objectContaining({
          pspReference: VENDOR_PAY,
          transaction: expect.objectContaining({
            type: 'Charge',
            state: 'Failure',
            amount: expect.objectContaining({ centAmount: 1500, currencyCode: 'EUR' }),
          }),
        }),
      );
    });

    /**
     * The duplicate gate must test the leg the refusal will RECORD (`Charge:Failure`), not the state
     * machine's default type for `FAILED` (`Authorization:Failure`). A payment that carries
     * `Authorization:Success` under the vendor payment id — what the create and return legs stamp — would
     * otherwise answer `duplicate` to every refused capture, refund and void, record nothing, and keep the
     * marker so the redelivery is refused too.
     */
    test('a refused charge on a payment already carrying Authorization:Success under the vendor payment id still records Charge:Failure', async () => {
      const h = makeReplayHarness({
        seedTransactions: [{ type: 'Authorization', state: 'Success', interactionId: VENDOR_PAY }],
      });
      await buildApp(
        h.ports,
        fakeGetPayment('canceled', MERCHANT_REF, VENDOR_PAY, [
          { type: 'charge', status: 'error', url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/op-1` },
        ]),
      );

      const response = await inject(envelope({ event: 'charge.failed', opId: 'op-1' }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ outcome: 'processed' });
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toEqual(
        expect.objectContaining({
          transaction: expect.objectContaining({ type: 'Charge', state: 'Failure', interactionId: 'op-1' }),
        }),
      );
    });

    // The `authorize.failed` event settles the payment's OWN authorization leg, so its refusal is an
    // `Authorization:Failure`. Typing it `Charge` would book a refused authorization as a refused capture and
    // leave the panel reading capture headroom against an authorization the vendor declined.
    test('a refused authorization under the authorize event records Authorization:Failure', async () => {
      const h = makeReplayHarness();
      await buildApp(
        h.ports,
        fakeGetPayment('canceled', MERCHANT_REF, VENDOR_PAY, [
          {
            type: 'authorization',
            status: 'error',
            url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/authorize/op-2`,
          },
        ]),
      );

      const response = await inject(envelope({ event: 'authorize.failed', resource: 'authorize', opId: 'op-2' }));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ outcome: 'processed' });
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toEqual(
        expect.objectContaining({
          transaction: expect.objectContaining({ type: 'Authorization', state: 'Failure', interactionId: 'op-2' }),
        }),
      );
    });
  });

  describe('refund reconciliation (the notification names the parent payment)', () => {
    test('a refund event reconciles by the echoed merchant reference and records Refund:Success', async () => {
      const h = makeReplayHarness();
      // A refund notification: Unzer models a refund as a cancellation of a charge, so the resource
      // URL points at the cancellation leg — whose SUCCEEDED outcome settles the refund (the event
      // name alone settles nothing). The authoritative payment echoes the merchant reference.
      const getPayment = fakeGetPayment('completed', MERCHANT_REF, VENDOR_PAY, [
        {
          type: 'cancellation',
          status: 'success',
          url: `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAY}/charges/s-chg-1/cancels/refund-xyz`,
        },
      ]);
      await buildApp(h.ports, getPayment);
      const payload = envelope({ event: 'charge.canceled', resource: 'charges/s-chg-1/cancels', opId: 'refund-xyz' });

      const response = await inject(payload);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ outcome: 'processed' });
      // Reconciled by the echoed merchant reference (scoped to the store) — never the payment id.
      expect(h.ports.paymentStore.findByMerchantReference).toHaveBeenCalledWith(MERCHANT_REF, STORE_KEY);
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0]).toEqual(
        expect.objectContaining({
          id: 'pay-1',
          pspReference: VENDOR_PAY,
          transaction: expect.objectContaining({
            type: 'Refund',
            state: 'Success',
            // Charge scoped: the cancellation is numbered within `s-chg-1`, its parent charge.
            interactionId: 's-chg-1.refund-xyz',
          }),
        }),
      );
    });
  });

  describe('cross-store isolation (the merchant reference is not a secret)', () => {
    test("an event admitted under a DIFFERENT store's own token never reconciles onto this store payment", async () => {
      const h = makeReplayHarness();
      await buildApp(h.ports, fakeGetPayment('completed'));
      const payload = envelope({ event: 'charge.succeeded', opId: 'op-1' });

      // The same payload that reconciles at /webhooks/store-1/…, delivered to a DIFFERENT store's
      // capability URL (a party holding that store's token). The token verifies for that store, but
      // the store-scoped lookup finds no payment → no write.
      const response = await inject(payload, 'store-attacker');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ outcome: 'ignored' });
      expect(h.ports.paymentStore.findByMerchantReference).toHaveBeenCalledWith(MERCHANT_REF, 'store-attacker');
      expect(h.updates).toHaveLength(0);
    });
  });

  describe('platform key contract (the CT custom-object charset the marker store persists into)', () => {
    test('the harness guard rejects an out-of-charset key — a `:` composite can never go green again', async () => {
      const h = makeReplayHarness();
      // The guard itself, exercised directly: a silent loosening of the charset assertion must fail
      // a test, not nothing.
      await expect(h.ports.markerStore.claim('vendor-pay-1:payment.captured:op-1')).rejects.toThrow(
        /custom-object key contract/,
      );
      await expect(h.ports.markerStore.claim('vendor-pay-1~payment.captured~op-1')).resolves.toBe(true);
    });
  });
});
