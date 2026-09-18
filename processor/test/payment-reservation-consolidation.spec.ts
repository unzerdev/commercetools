/**
 * The reservation → settlement → WEBHOOK proof (T19a).
 *
 * A reserved leg is only useful if the SETTLING WEBHOOK lands on it. The webhook reflects its Transaction
 * through the SDK's `updatePayment`, which consolidates by matching type + `interactionId`
 * (`DefaultPaymentService.findMatchingTransactions`) and will otherwise APPEND a second leg — and it can
 * never re-key a leg itself (`shouldUpdateInteractionId` stamps only a leg that carries NO id). So the leg
 * the intent leaves behind must already carry the VENDOR's operation id: that is what `settle` stamps.
 *
 * The proof therefore drives BOTH real sides — the repository's own posted actions applied to a CT Payment
 * double, then the SDK's REAL `consolidateTransactionChanges` over the payment that came out. Two
 * mutually-mocked halves would agree with each other and prove nothing.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Payment } from '@commercetools/connect-payments-sdk';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import {
  releaseTransaction,
  reserveTransaction,
  settleTransaction,
} from '../src/infrastructure/commercetools/payments.repository';
import { applyModification, modifyPayment } from '../src/application/orchestration';
import { handleWebhook } from '../src/application/orchestration';
import { paymentAmounts } from '../src/application/orchestration';
import { reconcileReservations, reportMintedLegs } from '../src/application/orchestration';
import { PaymentStoreAdapter } from '../src/infrastructure/adapters/payment-store.adapter';
import type { Money, ProviderOperation, StoreConfig } from '../src/domain';
import { mintOperationReference } from '../src/domain';
import { PaymentState } from '../src/domain';
import { toRawStatus } from '../src/providers/psp/status';
import { PspWebhookHandler } from '../src/providers/psp/webhook/webhook.handler';
import { toDecimalAmount } from '../src/providers/psp/client';
import type { PspClient, PspConnectionConfig, UnzerPayment } from '../src/providers/psp/client';
import { mapProviderStatus } from '../src/providers/psp/status';
import { assertCtCustomObjectKey, unnamedOperationResult } from './support/fake-provider-module';

const AMOUNT = { centAmount: 500, currencyCode: 'EUR' };

/** A resolved per-store config for the built-in psp provider (read for the vendor client connection). */
const storeConfig = (): StoreConfig => ({
  storeKey: 'main',
  mode: 'sandbox',
  inheritsDefaultScope: false,
  host: 'http://localhost:8080',
  vendorHosts: { sandbox: 'http://localhost:8080', live: 'http://localhost:8080' },
  integrator: 'PSP',
  connector: { creator: 'Logeecom', name: 'test-commercetools', version: '0.0.0-test' },
  credentials: { apiKeyId: 'key-id', apiSecret: 'api-secret', merchantId: 'merchant-1' },
  settings: {},
  telemetry: { name: 'X-Psp-ServerMetaInfo' },
  endpoints: {},
  paymentTypeKey: 'psp-payment',
  requestTimeoutMs: 30000,
});

/** The webhook's Transaction draft for the settled capture: keyed on the VENDOR operation id. */
const WEBHOOK_CAPTURE = {
  type: 'Charge' as const,
  state: 'Success' as const,
  amount: AMOUNT,
  interactionId: 'op-77',
};

/**
 * A CT Payment double that APPLIES the update actions the repository posts (the three the reservation trio
 * emits) and enforces the version CAS, so the payment the webhook then reads is the one the repository
 * really produced — not a hand-written fixture that assumes the answer.
 */
function ctPaymentDouble(): { payment: any; apply: (action: any) => void } {
  const payment: any = { id: 'pay-1', version: 1, amountPlanned: AMOUNT, transactions: [] };
  let sequence = 0;

  const leg = (id: string): any => {
    const found = payment.transactions.find((t: any) => t.id === id);
    if (!found) {
      throw new Error(`Action targets an unknown transaction ${id}`);
    }
    return found;
  };

  const apply = (action: any): void => {
    switch (action.action) {
      case 'addTransaction':
        sequence += 1;
        payment.transactions.push({ id: `tx-${sequence}`, ...action.transaction });
        return;
      case 'changeTransactionState':
        leg(action.transactionId).state = action.state;
        return;
      case 'changeTransactionInteractionId':
        leg(action.transactionId).interactionId = action.interactionId;
        return;
      case 'setInterfaceId':
        payment.interfaceId = action.interfaceId;
        return;
      default:
        throw new Error(`Unexpected action ${action.action}`);
    }
  };

  const builder = {
    withId: () => ({
      get: () => ({ execute: async () => ({ body: payment }) }),
      post: (args: { body: { version: number; actions: any[] } }) => ({
        execute: async () => {
          if (args.body.version !== payment.version) {
            throw { statusCode: 409, body: { errors: [{ code: 'ConcurrentModification' }] } };
          }
          args.body.actions.forEach(apply);
          payment.version += 1;
          return { body: payment };
        },
      }),
    }),
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'payments').mockReturnValue(builder as never);
  return { payment, apply };
}

/** The handles the reserved legs are settled by: the leg's TYPE and the name the reservation minted. */
const CHARGE_LEG = { type: 'Charge' as const, interactionId: 'intent-1' };
const CANCEL_LEG = { type: 'CancelAuthorization' as const, interactionId: 'intent-cancel-1' };

/** Reserve a Charge under the caller's own intent id — the write-ahead leg every money path starts with. */
const reserve = (version: number) =>
  reserveTransaction({
    id: 'pay-1',
    version,
    transaction: { ...CHARGE_LEG, amount: AMOUNT },
  });

/** The consolidation the webhook's `updatePayment` runs — the REAL SDK, not a replica of it. */
const consolidate = (payment: any) =>
  paymentSDK.ctPaymentService.consolidateTransactionChanges(payment as Payment, WEBHOOK_CAPTURE);

/**
 * The provider's reported operation list, as the panel read hands it to `reconcileReservations`: each entry is
 * a {@link ProviderOperation} carrying the vendor's own operation id — the ONE key a standing leg is matched
 * by — plus the amount and the raw status envelope. Built directly here (the vendor read's exact wire shape is
 * the provider's concern, tested at `psp-mapping.spec.ts`).
 */
const vendorOperations = (...operations: Record<string, unknown>[]): ProviderOperation[] =>
  operations.map((op) => ({
    ...(op.id ? { id: op.id as string } : {}),
    ...(op.amount ? { amount: op.amount as Money } : {}),
    rawStatus: toRawStatus(op.status as PaymentState),
  }));

/**
 * A panel load that comes LATER — every standing leg aged past the staleness window, which is the whole of
 * "later" to the reconciler. It judges a leg by the `timestamp` commercetools stamps on it (the SDK's
 * `populateAddTransactionAction` does so on every leg it appends, the reservation writes its own), and it
 * refuses to touch a leg a live request could still be holding.
 */
const anHourOld = (payment: any): void => {
  payment.transactions
    .filter((leg: any) => leg.state === 'Pending')
    .forEach((leg: any) => {
      leg.timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    });
};

describe('reservation → settle → webhook consolidation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the webhook ADVANCES the stamped leg instead of appending a second one', async () => {
    const { payment, apply } = ctPaymentDouble();
    await reserve(payment.version);
    // The vendor accepted the capture and settles it by webhook: the leg stays Pending, but now carries the
    // vendor's operation id — the only key the webhook can find it by.
    await settleTransaction('pay-1', CHARGE_LEG, { state: 'Pending', providerOperationId: 'op-77' });

    const actions = consolidate(payment);

    expect(actions).toEqual([{ action: 'changeTransactionState', transactionId: 'tx-1', state: 'Success' }]);
    actions.forEach(apply);
    // One leg, the reserved one — settled in place, still carrying the amount the headroom was spent on.
    expect(payment.transactions).toHaveLength(1);
    expect(payment.transactions[0]).toMatchObject({
      id: 'tx-1',
      type: 'Charge',
      state: 'Success',
      interactionId: 'op-77',
      amount: AMOUNT,
    });
  });

  it('a redelivered webhook for an already-settled leg consolidates to NO action', async () => {
    const { payment } = ctPaymentDouble();
    await reserve(payment.version);
    await settleTransaction('pay-1', CHARGE_LEG, { state: 'Success', providerOperationId: 'op-77' });

    expect(consolidate(payment)).toEqual([]);
    expect(payment.transactions).toHaveLength(1);
  });

  // WITHOUT the stamp the same webhook DUPLICATES the leg — which is why `TransactionSettlement` REQUIRES the
  // vendor operation id, and why a leg the vendor never named is left standing rather than settled: a leg
  // still keyed on our reservation name is one the webhook appends beside. Standing, that duplicate costs only
  // a `Pending` leg holding the headroom shut (the money is counted once, by the webhook's leg); settled to
  // `Success` it would be a second record of the same money.
  it('a leg still keyed on the reservation name is one the webhook APPENDS beside — never advances', async () => {
    const { payment, apply } = ctPaymentDouble();
    await reserve(payment.version);

    const actions = consolidate(payment);
    actions.forEach(apply);

    expect(actions[0]).toMatchObject({ action: 'addTransaction' });
    expect(payment.transactions).toHaveLength(2);
    // The money is counted ONCE: only the webhook's leg is Success.
    expect(payment.transactions.filter((t: any) => t.state === 'Success')).toHaveLength(1);
  });

  it('two legs sharing one vendor operation id POISON the SDK consolidation', async () => {
    const { payment, apply } = ctPaymentDouble();
    apply({ action: 'addTransaction', transaction: { type: 'Charge', state: 'Pending', interactionId: 'op-77' } });
    apply({ action: 'addTransaction', transaction: { type: 'Charge', state: 'Success', interactionId: 'op-77' } });

    // Not cosmetic: from here EVERY later Charge webhook throws, so the connector 5xx's forever on a payment
    // whose money already moved. This is the state `settle` must never create — see the case below.
    expect(() => consolidate(payment)).toThrow(/Multiple matching transactions/);
  });

  it('when the webhook BEAT the settle, the reservation is released — never stamped into a twin', async () => {
    const { payment, apply } = ctPaymentDouble();
    await reserve(payment.version);
    // The webhook arrived before the vendor's answer reached us: it could not find our leg (still keyed on
    // the reservation id), so it appended its own, already carrying the operation id.
    apply({
      action: 'addTransaction',
      transaction: { type: 'Charge', state: 'Success', interactionId: 'op-77', amount: AMOUNT },
    });

    await settleTransaction('pay-1', CHARGE_LEG, { state: 'Success', providerOperationId: 'op-77' });

    // Exactly one leg carries the vendor id — the webhook's, which is the true record of the money.
    expect(payment.transactions.filter((t: any) => t.interactionId === 'op-77')).toHaveLength(1);
    // Ours is released, so the headroom the phantom held comes back instead of blocking every later refund.
    expect(payment.transactions[0]).toMatchObject({ id: 'tx-1', state: 'Failure', interactionId: 'intent-1' });
    expect(() => consolidate(payment)).not.toThrow();
  });

  // The twin the release defends against is TYPE + `interactionId` — what the SDK matches on — and never the
  // id alone. A cancel is the case that proves it: the vendor answers a cancel with `{ payment }`, so the
  // operation id it reports IS the vendor PAYMENT id, which `create-payment.ts` already stamped on the
  // Authorization leg. Read type-blind, the settle would release a cancel the vendor PERFORMED.
  it('a cancel whose operation id is the vendor PAYMENT id settles in place — the Authorization leg is no twin', async () => {
    const { payment, apply } = ctPaymentDouble();
    apply({
      action: 'addTransaction',
      transaction: { type: 'Authorization', state: 'Success', interactionId: 'vendor-pay-1', amount: AMOUNT },
    });
    await reserveTransaction({
      id: 'pay-1',
      version: payment.version,
      transaction: { ...CANCEL_LEG, amount: AMOUNT },
    });

    await settleTransaction('pay-1', CANCEL_LEG, { state: 'Success', providerOperationId: 'vendor-pay-1' });

    // The void is RECORDED: Success, and stamped, so the settling webhook lands on this leg.
    expect(payment.transactions[1]).toMatchObject({
      type: 'CancelAuthorization',
      state: 'Success',
      interactionId: 'vendor-pay-1',
    });
    // Two legs share the id, and that is legitimate: they differ in type, so the SDK matches exactly one.
    expect(
      paymentSDK.ctPaymentService.consolidateTransactionChanges(payment as Payment, {
        type: 'CancelAuthorization',
        state: 'Success',
        amount: AMOUNT,
        interactionId: 'vendor-pay-1',
      }),
    ).toEqual([]);
  });

  /**
   * What reconciliation may write onto a standing leg, driven through the REAL repository and then judged by
   * the SDK's OWN consolidation — because the property at stake is a leg's KEY surviving the write, and a leg
   * whose key moved is a leg the settling webhook duplicates instead of advancing. Any faked link here would
   * simply agree with the next.
   *
   * Two inputs, one rule. An operation the vendor reports without an `id` names no leg at all, so nothing is
   * written and the leg keeps the key it has. An operation the vendor DOES name matches the leg already keyed
   * on that id, and the write advances the leg's state and leaves its key alone — so the webhook's own draft
   * consolidates onto that same leg rather than appending a second record of the same money.
   */
  describe('what reconciliation writes onto a standing leg', () => {
    const REFUND_REFERENCE = mintOperationReference('psp', 'pay-1', 1, 'Refund', AMOUNT);
    const REFUND_LEG = { type: 'Refund' as const, interactionId: REFUND_REFERENCE };
    const VENDOR_REFUND_ID = 'gw-refund-77';
    const VENDOR_KEYED_LEG = { type: 'Refund' as const, interactionId: VENDOR_REFUND_ID };

    const env = {
      brand: { paymentInterface: 'psp' },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };

    /** The REAL repository behind the port: what reconciliation writes is what commercetools is posted. */
    const deps = (payment: any) =>
      ({
        ports: {
          paymentStore: {
            get: async () => payment,
            settle: settleTransaction,
            release: releaseTransaction,
          },
        },
        provider: { mapProviderStatus },
      }) as never;

    /** A leg reserved under the minted name: the refund's vendor call never answered, and it stands. */
    const givenStandingRefund = async (payment: any): Promise<void> => {
      await reserveTransaction({
        id: 'pay-1',
        version: payment.version,
        transaction: { ...REFUND_LEG, amount: AMOUNT },
      });
      anHourOld(payment);
    };

    /**
     * A leg already keyed on the vendor's own operation id — the shape a modification whose answer was read as
     * an acknowledgement leaves behind, and the one shape reconciliation matches.
     */
    const givenVendorKeyedRefund = async (payment: any): Promise<void> => {
      await reserveTransaction({
        id: 'pay-1',
        version: payment.version,
        transaction: { ...VENDOR_KEYED_LEG, amount: AMOUNT },
      });
      anHourOld(payment);
    };

    const reconcile = (payment: any, operations: unknown[]) =>
      reconcileReservations(payment as never, operations as never, env as never, deps(payment));

    it('leaves the leg keyed on the name that can still find it — never on an empty id', async () => {
      const { payment } = ctPaymentDouble();
      await givenStandingRefund(payment);

      // A reported operation with NO `id` — the vendor holds the operation but has not named it, so it names
      // no leg either.
      await reconcile(payment, vendorOperations({ kind: 'refund', status: 'REFUND_REQUESTED' }));

      expect(payment.transactions).toEqual([
        expect.objectContaining({ type: 'Refund', state: 'Pending', interactionId: REFUND_REFERENCE }),
      ]);
    });

    it('advances the vendor-keyed leg in place, so the settling webhook lands on it and appends nothing', async () => {
      const { payment, apply } = ctPaymentDouble();
      await givenVendorKeyedRefund(payment);

      await reconcile(payment, vendorOperations({ id: VENDOR_REFUND_ID, kind: 'refund', status: 'REFUNDED' }));

      const actions = paymentSDK.ctPaymentService.consolidateTransactionChanges(payment as Payment, {
        type: 'Refund',
        state: 'Success',
        amount: AMOUNT,
        interactionId: VENDOR_REFUND_ID,
      });
      actions.forEach(apply);

      // ONE leg, advanced in place and still carrying the vendor's id: the webhook's draft matches it and has
      // nothing left to change. Had the write moved the key, the webhook would have appended a second Refund
      // and the panel would show the same money given back twice.
      expect(actions).toEqual([]);
      expect(payment.transactions).toEqual([
        expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: VENDOR_REFUND_ID }),
      ]);
    });
  });

  /**
   * The same vendor answer on the WRITE side of the seam: the operation the vendor PERFORMS and does not
   * name. `OperationResult.providerOperationId` is optional in the neutral contract — a real vendor may
   * legally answer a 200 without an operation id of its own — so a settled capture can reach
   * `closeReservedLeg` with nothing to key the leg by.
   *
   * Settling it anyway would leave the leg `Success` under OUR reservation name — a key the settling webhook
   * cannot match (it dedupes on the vendor operation id and the vendor payment id, and the leg carries
   * neither), so the webhook APPENDS its own `Charge:Success` beside it and the same 5.00 EUR reads as 10.00
   * paid, with the refund headroom doubled to match. So the write path takes the read path's decision on the
   * read path's input: a leg the vendor has not named is not settleable, and it STAYS.
   *
   * The built-in psp provider (simulator) always names its operations, so the unnamed answer is given at the
   * `ModificationHandler` seam — the very contract a real vendor answers through. Everything downstream of it
   * is real: the orchestration, the repository, and finally the SDK's own `consolidateTransactionChanges` —
   * the defect is one VALUE crossing those layers, and any faked link would simply agree with the next.
   */
  describe('an operation the vendor ANSWERS but does not name', () => {
    const CAPTURE_REFERENCE = mintOperationReference('psp', 'pay-1', 1, 'Charge', AMOUNT);
    const CAPTURE_LEG = { type: 'Charge' as const, interactionId: CAPTURE_REFERENCE };
    const VENDOR_PAYMENT_ID = 'p_1';

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    beforeEach(() => {
      logger.error.mockClear();
    });

    /** The vendor CAPTURES and reports no operation id — a legal answer under the neutral contract. */
    const capturesWithoutNamingIt = {
      capture: async () => unnamedOperationResult(toRawStatus(PaymentState.CAPTURED)),
    };

    /** The REAL repository behind the ports; only the unnamed vendor answer is given at the provider seam. */
    const deps = () =>
      ({
        ports: {
          paymentStore: {
            settle: settleTransaction,
            release: releaseTransaction,
            setReviewFlag: jest.fn(),
            update: jest.fn(),
          },
        },
        provider: { key: 'psp', mapProviderStatus, modifications: capturesWithoutNamingIt },
      }) as never;

    /** The Merchant Center capture: its leg is reserved, so the vendor's answer must CLOSE that leg. */
    const capture = (payment: any) =>
      applyModification(
        {
          env: { logger, brand: { paymentInterface: 'psp' } },
          cfg: storeConfig(),
          payment,
          action: { action: 'capturePayment', amount: AMOUNT },
          leg: { type: 'Charge', amount: AMOUNT },
          operationReference: CAPTURE_REFERENCE,
          reserved: true,
        } as never,
        deps(),
      );

    /** An authorized payment with the capture's leg already reserved — the state the vendor call is made in. */
    const givenReservedCapture = async (payment: any, apply: (action: any) => void): Promise<void> => {
      payment.interfaceId = VENDOR_PAYMENT_ID;
      apply({
        action: 'addTransaction',
        transaction: { type: 'Authorization', state: 'Success', interactionId: VENDOR_PAYMENT_ID, amount: AMOUNT },
      });
      await reserveTransaction({
        id: 'pay-1',
        version: payment.version,
        transaction: { ...CAPTURE_LEG, amount: AMOUNT },
      });
    };

    it('the leg is NOT settled under a name the webhook cannot find — the capture is counted once', async () => {
      const { payment, apply } = ctPaymentDouble();
      await givenReservedCapture(payment, apply);

      const answer = await capture(payment);
      // The settling webhook now arrives, carrying the vendor's own operation id — the key it dedupes on, and
      // one our leg cannot be carrying.
      consolidate(payment).forEach(apply);

      // ONE leg records the money — the webhook's. Settled under our name, our leg would be a SECOND
      // `Charge:Success` for the same capture, and the 5.00 EUR captured would read back as 10.00 refundable.
      const settledCaptures = payment.transactions.filter((t: any) => t.type === 'Charge' && t.state === 'Success');
      expect(settledCaptures).toEqual([expect.objectContaining({ interactionId: 'op-77', amount: AMOUNT })]);
      expect(paymentAmounts(payment).refundable).toStrictEqual(AMOUNT);
      // Fail-closed: the standing leg still spends the capture headroom, so no second capture goes out.
      expect(paymentAmounts(payment).capturable).toStrictEqual({ centAmount: 0, currencyCode: 'EUR' });
      // The leg stays exactly as the reservation left it — ours, Pending, and findable by the next load.
      expect(payment.transactions[1]).toMatchObject({
        type: 'Charge',
        state: 'Pending',
        interactionId: CAPTURE_REFERENCE,
      });
      // The vendor's answer still reaches the operator: it captured, and the response says so.
      expect(answer).toStrictEqual({ outcome: 'approved', pspReference: VENDOR_PAYMENT_ID });
    });

    it('the standing leg is logged as the fault it is, naming the leg the runbook needs', async () => {
      const { payment, apply } = ctPaymentDouble();
      await givenReservedCapture(payment, apply);

      await capture(payment);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('without naming the operation'), {
        paymentId: 'pay-1',
        transactionType: 'Charge',
        interactionId: CAPTURE_REFERENCE,
      });
    });
  });

  /**
   * The UNRESERVED (Checkout) half of that same seam. `POST /operations/payment-intents/:id` reserves
   * nothing, so the vendor's answer is the FIRST thing written about the operation: the leg is APPENDED, not
   * settled — and it must therefore carry a key of its own.
   *
   * The vendor PAYMENT id cannot be that key. It names the payment, not the operation, so two unnamed
   * operations of one type collide on it — and the SDK resolves a single match by advancing the EXISTING
   * leg's state and id, NEVER its amount (a leg already in the target state yields no actions at all, and
   * `updatePayment` then writes nothing). The second operation's money is recorded nowhere, the headroom runs
   * high by exactly that amount, and the panel and the intent guard both authorize money that is already
   * gone. That is the one direction this connector may never fail in.
   *
   * So an unnamed operation is keyed on OUR name for it, which is unique per operation BY CONSTRUCTION: the
   * name is the vendor's idempotency key, so two operations that mint one name are one operation to the
   * vendor and one leg is the true record. And it is written `Pending`, never `Success` — the settling
   * webhook cannot match our name and appends its own settled leg beside it, so a `Success` leg of ours would
   * be a second record of the same money. Exactly what the reserved path leaves behind for this same answer.
   *
   * Driven end to end, for the reason this file exists: the unnamed vendor answer given at the
   * `ModificationHandler` seam (the built-in psp provider's gateway always names its operations, so the
   * absence a real vendor can produce is given at the neutral contract), then the real Checkout
   * orchestration, the real repository, the SDK's own real `consolidateTransactionChanges`, and finally the
   * real webhook handler. The defect is one VALUE crossing all of them, and any faked link would simply
   * agree with the next.
   */
  describe('two unnamed operations of one type on the UNRESERVED (Checkout) path', () => {
    // PARTIAL refunds of the settled 5.00, deliberately: a fixture that gives back the whole 5.00 reads a
    // `refundable` of 0 whether the payment is healthy (500 − 500) or wedged (500 − 1000, clamped), so every
    // assertion over the headroom would pass on a broken payment too. 2.00 + 1.00 of 5.00 tells them apart.
    const FIRST = { centAmount: 200, currencyCode: 'EUR' };
    const SECOND = { centAmount: 100, currencyCode: 'EUR' };
    const LEFT_TO_REFUND = { centAmount: 200, currencyCode: 'EUR' };
    const VENDOR_PAYMENT_ID = 'p_1';
    const MERCHANT_REFERENCE = 'psp-8f2k9q1zx4mn-0';
    const NOTHING = { centAmount: 0, currencyCode: 'EUR' };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const env = { logger, brand: { paymentInterface: 'psp' } };
    const store = new PaymentStoreAdapter(paymentSDK.ctPaymentService);

    /** The vendor REFUNDS and reports no operation id — a legal answer under the neutral contract. */
    const refundsWithoutNamingIt = {
      refund: async () => unnamedOperationResult(toRawStatus(PaymentState.REFUNDED)),
    };

    /** The REAL commercetools write path — the SDK's own consolidation decides the leg; only the unnamed
     *  vendor answer is given at the provider seam. */
    const deps = (payment: any) =>
      ({
        ports: {
          paymentStore: {
            get: async () => payment,
            update: (args: any) => store.update(args),
            setReviewFlag: jest.fn(),
            settle: settleTransaction,
            release: releaseTransaction,
          },
          configResolver: { resolve: async () => storeConfig() },
        },
        provider: { key: 'psp', mapProviderStatus, modifications: refundsWithoutNamingIt },
      }) as never;

    /** A payment whose 5.00 EUR is captured and settled: 5.00 paid, 5.00 refundable, nothing given back yet. */
    const givenSettledCapture = (payment: any, apply: (action: any) => void): void => {
      payment.interfaceId = VENDOR_PAYMENT_ID;
      apply({
        action: 'addTransaction',
        transaction: { type: 'Authorization', state: 'Success', interactionId: VENDOR_PAYMENT_ID, amount: AMOUNT },
      });
      apply({
        action: 'addTransaction',
        transaction: { type: 'Charge', state: 'Success', interactionId: 'gw-cap-1', amount: AMOUNT },
      });
    };

    /** The Checkout route itself: it loads the payment, names the operation off the version it read, dispatches. */
    const checkoutRefund = (payment: any, amount: typeof FIRST) =>
      modifyPayment(
        {
          env,
          storeKey: 'main',
          paymentId: 'pay-1',
          data: { actions: [{ action: 'refundPayment', amount }] },
        } as never,
        deps(payment),
      );

    /**
     * The settling Unzer refund webhook. Unzer's event carries only the resource URL / payment id, so
     * the REAL handler reads the authoritative payment: it NAMES the cancellation leg (whose amount is
     * this refund's per-operation delta) and echoes the merchant reference the reconciler locates it by.
     * The sync answer omitting the operation id does not mean the webhook's authoritative read will.
     */
    const settleByWebhook = (payment: any, vendorRefundId: string, amount: typeof FIRST) => {
      const retrieveUrl = `https://sbx-api.unzer.com/v1/payments/${VENDOR_PAYMENT_ID}/charges/s-chg-1/cancels/${vendorRefundId}`;
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.canceled',
          publicKey: 's-pub-test',
          paymentId: VENDOR_PAYMENT_ID,
          retrieveUrl,
        }),
      );

      const authoritative: UnzerPayment = {
        id: VENDOR_PAYMENT_ID,
        state: { name: 'completed' },
        paymentReference: MERCHANT_REFERENCE,
        currency: amount.currencyCode,
        transactions: [
          { type: 'cancellation', status: 'success', url: retrieveUrl, amount: toDecimalAmount(amount.centAmount, 2) },
        ],
      };
      const getPayment = jest
        .fn<(cfg: PspConnectionConfig, paymentId: string) => Promise<UnzerPayment>>()
        .mockResolvedValue(authoritative);

      return handleWebhook(
        {
          env,
          storeKey: 'main',
          rawBody,
          token: 'tok-main',
        } as never,
        {
          ports: {
            // The capability-URL gate: this harness proves reconciliation, not the token crypto
            // (that is `crypto-webhook-token.spec.ts`), so the check simply admits the request.
            crypto: { verifyWebhookUrlToken: () => true },
            configResolver: { resolve: async () => storeConfig() },
            markerStore: {
              claim: async (key: string) => {
                assertCtCustomObjectKey(key);
                return true;
              },
              release: jest.fn(),
            },
            paymentStore: {
              findByMerchantReference: async () => payment,
              update: (args: any) => store.update(args),
              setReviewFlag: jest.fn(),
            },
          },
          provider: {
            key: 'psp',
            mapProviderStatus,
            webhook: new PspWebhookHandler({
              payments: { get: getPayment } as unknown as PspClient['payments'],
              webhooks: {
                register: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
                delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
              } as unknown as PspClient['webhooks'],
            }),
          },
        } as never,
      );
    };

    it('records BOTH refunds — the second is not swallowed by the first leg key', async () => {
      const { payment, apply } = ctPaymentDouble();
      givenSettledCapture(payment, apply);

      await checkoutRefund(payment, FIRST);
      await checkoutRefund(payment, SECOND);

      // 2.00 and 1.00 are two operations and two legs. Keyed on the vendor PAYMENT id they are ONE leg, and
      // the SDK advances it without ever touching its amount — so the 1.00 refund is recorded nowhere at all.
      const refunds = payment.transactions.filter((t: any) => t.type === 'Refund');
      expect(refunds.map((t: any) => t.amount)).toStrictEqual([FIRST, SECOND]);
      // The headroom is the money the connector will still let out, and it is what both the panel's button
      // and the intent guard read: 3.00 of the 5.00 is spoken for, so 2.00 is left. Had the second refund
      // collided onto the first leg it would read 3.00 — and the connector would offer back money already gone.
      expect(paymentAmounts(payment).refundable).toStrictEqual(LEFT_TO_REFUND);
    });

    it('and the settling webhooks then record each refund exactly ONCE', async () => {
      const { payment, apply } = ctPaymentDouble();
      givenSettledCapture(payment, apply);

      await checkoutRefund(payment, FIRST);
      await checkoutRefund(payment, SECOND);
      await settleByWebhook(payment, 'gw-ref-1', FIRST);
      await settleByWebhook(payment, 'gw-ref-2', SECOND);

      // The money that settled: 2.00 and 1.00, each on ONE leg — neither refund collided onto the other's.
      const settled = payment.transactions.filter((t: any) => t.type === 'Refund' && t.state === 'Success');
      expect(settled.map((t: any) => t.amount)).toStrictEqual([FIRST, SECOND]);
      // And the price of it, measured: our two standing legs go on spending the headroom that the webhook's
      // own settled legs now spend as well, so the 3.00 is charged TWICE and nothing at all is offered where
      // 2.00 is truly left. Fail-closed — it blocks a refund, never duplicates one — and it is what the next
      // panel load undoes (below), not something a human must.
      expect(paymentAmounts(payment).refundable).toStrictEqual(NOTHING);
    });

    it('the RESERVED path takes the same answer and leaves its leg standing — unchanged', async () => {
      const { payment, apply } = ctPaymentDouble();
      givenSettledCapture(payment, apply);

      const reference = mintOperationReference('psp', 'pay-1', payment.version, 'Refund', FIRST);
      await reserveTransaction({
        id: 'pay-1',
        version: payment.version,
        transaction: { type: 'Refund', interactionId: reference, amount: FIRST },
      });

      await applyModification(
        {
          env,
          cfg: storeConfig(),
          payment,
          action: { action: 'refundPayment', amount: FIRST },
          leg: { type: 'Refund', amount: FIRST },
          operationReference: reference,
          reserved: true,
        } as never,
        deps(payment),
      );

      // Exactly as the reservation left it: ours, Pending, and no second leg appended beside it.
      expect(payment.transactions.filter((t: any) => t.type === 'Refund')).toEqual([
        expect.objectContaining({ state: 'Pending', interactionId: reference, amount: FIRST }),
      ]);
    });

    /**
     * What a later panel load can do about the standing leg — and it is NOT to clear it.
     *
     * The leg the Checkout path appends carries the name the minter gave it, and no operation the provider can
     * report carries that name back: Unzer's payment read describes each leg as
     * `participantId`/`date`/`type`/`status`/`url`/`amount` and no merchant reference rides it. So the load
     * matches nothing, writes nothing, and REPORTS the leg at ERROR — the operator's runbook is the only thing
     * that clears it, and the headroom it holds stays shut until then.
     *
     * Driven through the REAL reconciler over the REAL repository, because the claim is about a value crossing
     * three links — the minted name, the SDK's timestamp and the staleness window — and a fake in any one of
     * them would agree with the next and prove nothing.
     */
    describe('the standing leg on the NEXT panel load', () => {
      const REFUND_REFERENCE = mintOperationReference('psp', 'pay-1', 1, 'Refund', FIRST);
      const VENDOR_REFUND_ID = 'gw-ref-1';
      /** The bound one vendor call runs under — what the staleness window this load judges by is derived from. */
      const VENDOR_DEADLINE_MS = 30_000;
      /** 2.00 refunded of 5.00, but charged to the headroom TWICE — the standing leg's true cost. */
      const WEDGED = { centAmount: 100, currencyCode: 'EUR' };

      /** The operation the vendor performed, unnamed, and then SETTLED by a webhook that did name it. */
      const givenAWedgedRefund = async (payment: any, apply: (action: any) => void): Promise<void> => {
        givenSettledCapture(payment, apply);
        await checkoutRefund(payment, FIRST);
        await settleByWebhook(payment, VENDOR_REFUND_ID, FIRST);
        anHourOld(payment);
      };

      /**
       * The panel load, in the order `getOrderPayments` runs it: the wedged-leg report first — it consumes no
       * operation and is raised whether or not the vendor answered — then the reconciliation of everything the
       * reported operations can be matched to, through the real reconciler and the real repository.
       */
      const panelLoad = async (payment: any, ...operations: Record<string, unknown>[]): Promise<void> => {
        reportMintedLegs(payment as never, VENDOR_DEADLINE_MS, env as never);
        await reconcileReservations(
          payment as never,
          vendorOperations(...operations),
          env as never,
          deps(payment) as never,
        );
      };

      /** The leg the load names in its report: the wedged refund, by type and by the key it carries. */
      const REPORTED_LEG = {
        paymentId: 'pay-1',
        transactionType: 'Refund',
        interactionId: REFUND_REFERENCE,
      };

      it('stands even when the vendor DOES name the operation: the minted name matches nothing reported', async () => {
        const { payment, apply } = ctPaymentDouble();
        await givenAWedgedRefund(payment, apply);

        // Wedged: our standing leg and the webhook's settled one BOTH spend the headroom, so the one 2.00
        // refund is charged twice and the panel offers 1.00 where 3.00 is truly left.
        expect(paymentAmounts(payment).refundable).toStrictEqual(WEDGED);

        await panelLoad(payment, { id: VENDOR_REFUND_ID, kind: 'refund', status: 'REFUNDED' });

        // The operation IS in the list, under the vendor's own id — and our leg is keyed on the minted name,
        // which that list cannot carry. So nothing is written and the payment stays wedged.
        expect(payment.transactions).toContainEqual(
          expect.objectContaining({ type: 'Refund', state: 'Pending', interactionId: REFUND_REFERENCE }),
        );
        expect(paymentAmounts(payment).refundable).toStrictEqual(WEDGED);
        // Which is why the load has to SAY so: this line is the operator's only signal that the payment needs
        // the runbook.
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('minted'), REPORTED_LEG);
      });

      it('still stands when the vendor never reports the operation — the case that IS the runbook', async () => {
        const { payment, apply } = ctPaymentDouble();
        await givenAWedgedRefund(payment, apply);

        // The load fetched the payment's operations and the refund is not among them. Absence is not evidence:
        // releasing on it would hand back headroom for money that may be gone. So nothing is written.
        await panelLoad(payment);

        expect(payment.transactions).toContainEqual(
          expect.objectContaining({ type: 'Refund', state: 'Pending', interactionId: REFUND_REFERENCE }),
        );
        expect(paymentAmounts(payment).refundable).toStrictEqual(WEDGED);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('minted'), REPORTED_LEG);
      });
    });
  });

  it('a concurrent write between the read and the reservation loses: the second reserve conflicts', async () => {
    const { payment } = ctPaymentDouble();
    const staleVersion = payment.version;

    await reserve(staleVersion);

    // The loser read the same version, and its reservation — not its vendor call — is what fails.
    await expect(reserve(staleVersion)).rejects.toThrow(/changed/);
    expect(payment.transactions).toHaveLength(1);
  });
});
