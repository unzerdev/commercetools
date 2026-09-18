/**
 * `handleWebhook` orchestration - the authoritative webhook reconciler,
 * exercised with fake ports + a fake provider. Asserts the DISPATCH + idempotency/failure contract
 * bad capability-URL token (an unknown store cannot pass the gate) → `unauthorized`;
 * a config-resolution fault propagates (route → 5xx); unknown kind / lookup-miss → `ignored`;
 * duplicate marker / already-reflected Transaction → `duplicate`; a settled capture reflects a
 * Charge:Success; a partial capture downgrades to `PARTIALLY_CAPTURED`; a processing failure releases
 * the marker and rethrows (route → 5xx), never masking the original error on a release failure.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { PaymentState } from '../src/domain';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- jest.spyOn must target the DEFINING module: the barrel's `export *` re-export binding is not configurable, so spying through '../src/domain' throws.
import * as stateMachine from '../src/domain/payment/state-machine';
import { handleWebhook } from '../src/application/orchestration';
import {
  assertCtCustomObjectKey,
  fakePayment,
  makeFakeEnv,
  makeFakePorts,
  makeFakeProviderModule,
} from './support/fake-provider-module';
import { statefulPaymentStore } from './support/in-memory-payment-store';
import { leg, ownedPayment } from './support/payment-fixtures';

describe('orchestration/handleWebhook', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let env: ReturnType<typeof makeFakeEnv>;

  // The composite marker key for the fake envelope (`vendor-pay-1` / `payment.captured` / `op-1`),
  // `~`-separated — the separator and every segment must stay inside the commercetools
  // custom-object key charset (alphanumerics plus `-_~.`).
  const KEY = 'vendor-pay-1~payment.captured~op-1';

  const ctx = () => ({ env, storeKey: 'store-1', rawBody: Buffer.from('{}'), token: 'tok-1' });

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    env = makeFakeEnv();
  });

  test('happy path: verified CAPTURED event reflects a Charge:Success and returns processed', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const res = await handleWebhook(ctx(), { ports, provider });

    // The capability-URL gate consulted the crypto port with the PATH pair before anything else.
    expect(ports.crypto.verifyWebhookUrlToken).toHaveBeenCalledWith('store-1', 'tok-1');
    expect(ports.markerStore.claim).toHaveBeenCalledWith(KEY);
    // Scoped to the route-path store whose token gated the event (cross-tenant guard).
    expect(ports.paymentStore.findByMerchantReference).toHaveBeenCalledWith('ref', 'store-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-1',
        pspReference: 'vendor-pay-1',
        transaction: expect.objectContaining({ type: 'Charge', state: 'Success', interactionId: 'op-1' }),
      }),
    );
    expect(ports.markerStore.release).not.toHaveBeenCalled();
    expect(res.outcome).toBe('processed');
  });

  /**
   * The reconciler learns the vendor's own code for the settlement, so it writes the page's PSP Status Code
   * and Payment state as its last act inside the marker-held fence. Asserted at the orchestration
   * level because the helper's own spec stays green with the call site deleted, and the fields then read `-`
   * for every webhook-settled payment.
   */
  describe('the payment status the page reads beside the transactions', () => {
    /** The default envelope plus the vendor's own code and text for the settled capture. */
    const withStatusCode = () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
        kind: 'payment.captured',
        paymentRef: 'ref',
        providerPaymentId: 'vendor-pay-1',
        operationId: 'op-1',
        rawStatus: {},
        statusCode: { code: 'COR.000.100.112', text: 'Your payment has been processed.' },
      });
    };

    test('is written from the settlement the event carries', async () => {
      withStatusCode();

      const res = await handleWebhook(ctx(), { ports, provider });

      expect(res.outcome).toBe('processed');
      expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
        interfaceCode: 'COR.000.100.112',
        interfaceText: 'Your payment has been processed.',
        stateKey: 'completed',
      });
    });

    // The Transaction above is the settlement and its marker is held, so a status line commercetools refuses
    // must not turn a settled delivery into a 5xx the vendor redelivers — nor release the marker it holds.
    test('a refused status write leaves the outcome processed and the marker held', async () => {
      withStatusCode();
      ports.paymentStore.setStatus = jest
        .fn<typeof ports.paymentStore.setStatus>()
        .mockRejectedValue(new Error('commercetools unavailable'));

      const res = await handleWebhook(ctx(), { ports, provider });

      expect(ports.paymentStore.setStatus).toHaveBeenCalledTimes(1);
      expect(res.outcome).toBe('processed');
      expect(ports.markerStore.release).not.toHaveBeenCalled();
    });
  });

  /**
   * A chargeback is the shopper's bank reversing settled funds. The connector subscribes the event
   * and reflects it as a `Refund` — commercetools has no chargeback Transaction type, and the
   * money left the merchant the same way a refund's does. `payment.chargeback` must therefore be a
   * HANDLED kind: leaving it out answered a 200 no-op and the reversal never reached the Payment.
   */
  test('chargeback: a payment.chargeback event reflects a Refund:Success and returns processed', async () => {
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.chargeback',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'cbk-1',
      rawStatus: {},
    });
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CHARGEBACK);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(ports.markerStore.claim).toHaveBeenCalledWith('vendor-pay-1~payment.chargeback~cbk-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-1',
        transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 'cbk-1' }),
      }),
    );
    expect(res.outcome).toBe('processed');
  });

  test('unauthorized: a failed token check returns unauthorized before any I/O — no resolve, no claim, no update', async () => {
    ports.crypto.verifyWebhookUrlToken = jest.fn<typeof ports.crypto.verifyWebhookUrlToken>().mockReturnValue(false);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('unauthorized');
    // The gate is a pure crypto compare BEFORE the config resolve (amplification defense).
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(provider.webhook.parse).not.toHaveBeenCalled();
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('infrastructure fault: a config-resolution throw PROPAGATES (route → 5xx, vendor redelivers) and never parses', async () => {
    // `resolveStoreConfig` never throws for an unknown store (the CT 404 maps to `null` and the env
    // layers still assemble a config), so a rejection here is a CT outage / fail-closed decrypt —
    // answering 401 would silently stop the vendor's redelivery over a transient fault.
    const boom = new Error('commercetools is unreachable');
    ports.configResolver.resolve = jest.fn<typeof ports.configResolver.resolve>().mockRejectedValue(boom);

    await expect(handleWebhook(ctx(), { ports, provider })).rejects.toBe(boom);
    expect(provider.webhook.parse).not.toHaveBeenCalled();
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // An unreadable delivery is indistinguishable from an empty one in the logs unless the bytes that
  // arrived are recorded. Without this line the operator has nothing to compare against what the vendor's
  // own dashboard says it delivered, and a retry storm reads as a mystery.
  test('unreadable body: the failure propagates AND the delivered bytes are logged', async () => {
    const boom = new Error('Unexpected end of JSON input');
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockRejectedValue(boom);
    const rawBody = Buffer.from('event=charge&paymentId=s-pay-1', 'utf8');

    await expect(handleWebhook({ ...ctx(), rawBody }, { ports, provider })).rejects.toBe(boom);

    expect(env.logger.error).toHaveBeenCalledWith(
      'Webhook body could not be interpreted',
      expect.objectContaining({
        byteLength: rawBody.length,
        bodyPrefix: 'event=charge&paymentId=s-pay-1',
        error: 'Unexpected end of JSON input',
      }),
    );
    // Nothing is claimed or written for a delivery that could not be read.
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('unknown kind: an unhandled event kind is a 200 no-op (ignored) with no marker claim', async () => {
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.something',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-1',
      rawStatus: {},
    });

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('ignored');
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('duplicate: a lost marker claim race returns duplicate with no update', async () => {
    // A SETTLED status, because the marker is only claimed for an event that would record something (an
    // accepted-but-unsettled operation answers a no-op before the claim).
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    // The duplicate stub still validates the key like the guarded fake it replaces.
    ports.markerStore.claim = jest.fn<typeof ports.markerStore.claim>().mockImplementation(async (key) => {
      assertCtCustomObjectKey(key);
      return false;
    });

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('duplicate');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // the DEFAULT SCOPE route serves the account every not-separately-connected store transacts
  // through, so its events settle payments stamped with THOSE stores' keys. The lookup therefore widens
  // past the route key — and the cross-tenant guard is re-imposed on the result instead.
  describe('default-scope route', () => {
    const defaultCtx = () => ({ env, storeKey: '__default__', rawBody: Buffer.from('{}'), token: 'tok-1' });

    /** A resolved config whose private key decides whether a payment belongs to the event's account. */
    const cfgWithKey = (privateKey: string) =>
      jest.fn<typeof ports.configResolver.resolve>().mockImplementation(async (storeKey: string) => ({
        ...(await makeFakePorts().configResolver.resolve(storeKey)),
        credentials: { privateKey },
      }));

    test('reconciles a payment stamped with an INHERITING store, not the route key', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      ports.configResolver.resolve = cfgWithKey('s-priv-default');
      ports.paymentStore.findByMerchantReference = jest
        .fn<typeof ports.paymentStore.findByMerchantReference>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'quiet-store' } } }));

      const res = await handleWebhook(defaultCtx(), { ports, provider });

      // Looked up WITHOUT a store scope (the payment lives in `quiet-store`, the route is the default).
      expect(ports.paymentStore.findByMerchantReference).toHaveBeenCalledWith('ref');
      expect(res.outcome).toBe('processed');
    });

    // The shape a live Unzer refund actually arrives in: the fetched payment echoes no merchant
    // reference, only the platform payment id the charge stamped, and the route is the default scope.
    test('falls back to the platform payment id when the payment echoes no merchant reference', async () => {
      provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
        kind: 'payment.refunded',
        paymentRef: '',
        platformPaymentId: 'pay-1',
        providerPaymentId: 'vendor-pay-1',
        operationId: 'op-1',
        rawStatus: {},
      });
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
      ports.configResolver.resolve = cfgWithKey('s-priv-default');
      ports.paymentStore.findById = jest
        .fn<typeof ports.paymentStore.findById>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'quiet-store' } } }));

      const res = await handleWebhook(defaultCtx(), { ports, provider });

      expect(ports.paymentStore.findByMerchantReference).not.toHaveBeenCalled();
      expect(ports.paymentStore.findById).toHaveBeenCalledWith('pay-1');
      expect(res.outcome).toBe('processed');
      expect(ports.paymentStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 'op-1' }),
        }),
      );
    });

    test('refuses a payment whose store holds a DIFFERENT account (the guard, moved not dropped)', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      ports.configResolver.resolve = jest
        .fn<typeof ports.configResolver.resolve>()
        .mockImplementation(async (storeKey: string) => ({
          ...(await makeFakePorts().configResolver.resolve(storeKey)),
          // The route's own scope authenticates as the default account; the payment's store is connected
          // with its own Unzer account, so a default-account signature must not reach it.
          credentials: { privateKey: storeKey === '__default__' ? 's-priv-default' : 's-priv-own' },
        }));
      ports.paymentStore.findByMerchantReference = jest
        .fn<typeof ports.paymentStore.findByMerchantReference>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'loud-store' } } }));

      const res = await handleWebhook(defaultCtx(), { ports, provider });

      expect(res.outcome).toBe('ignored');
      expect(ports.paymentStore.update).not.toHaveBeenCalled();
      expect(ports.markerStore.release).toHaveBeenCalledWith(KEY);
    });
  });

  test('lookup miss: no CT Payment for the interfaceId releases the marker and returns ignored', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(undefined);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('ignored');
    expect(ports.markerStore.release).toHaveBeenCalledWith(KEY);
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('out-of-order: a Charge:Success already reflected under this operation id is a duplicate that keeps the marker', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(fakePayment({ transactions: [{ type: 'Charge', state: 'Success', interactionId: 'op-1' }] }));

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('duplicate');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
    expect(ports.markerStore.release).not.toHaveBeenCalled();
  });

  test('cross-leg: a Charge:Success reflected by the sync/return leg (interactionId = vendor paymentId) is a duplicate', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(
        fakePayment({
          transactions: [{ type: 'Charge', state: 'Success', interactionId: 'vendor-pay-1' }],
        }),
      );

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('duplicate');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('per-operation: a Success Charge under a DIFFERENT operation id does not dedup — the new operation reflects', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(
        fakePayment({ transactions: [{ type: 'Charge', state: 'Success', interactionId: 'op-earlier' }] }),
      );

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('processed');
    expect(ports.paymentStore.update).toHaveBeenCalledTimes(1);
  });

  test('partial capture: acquired < total downgrades CAPTURED to PARTIALLY_CAPTURED and still updates', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.captured',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-1',
      acquiredAmount: { centAmount: 400, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.PARTIALLY_CAPTURED);
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ type: 'Charge', state: 'Success' }) }),
    );
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  // Refund partiality is measured the way the vendor's own reference integration measures it: the
  // payment's CUMULATIVE cancelled figure against the authorised total. The per-event delta cannot
  // answer the question — the second of two partial refunds looks partial on its own 600 even
  // though the two together return the whole 1000.
  test('the completing partial refund settles the payment in full: cumulative cancelled == total', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.refunded',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-refund-2',
      amount: { centAmount: 600, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 1000, currencyCode: 'EUR' },
      acquiredAmount: { centAmount: 1000, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.REFUNDED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  test('the first of two partial refunds stays PARTIALLY_REFUNDED: cumulative cancelled < total', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.refunded',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-refund-1',
      amount: { centAmount: 400, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 400, currencyCode: 'EUR' },
      acquiredAmount: { centAmount: 1000, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.PARTIALLY_REFUNDED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  // A refund is measured against what was CAPTURED, not against what was authorized - and this case is why
  // it has to be. Authorize 1000, capture 400, refund all 400: against the authorized total this reads
  // partial, but nothing more can ever be refunded, and the merchant path (which subtracts from the
  // commercetools refund headroom) correctly calls it REFUNDED. Both write `paymentStatus.state`, so a
  // disagreement here makes the payment flip between `refunded` and `partially-refunded` on its own.
  test('a refund of everything CAPTURED is full, whatever was authorized alongside it', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.refunded',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-refund-1',
      amount: { centAmount: 400, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 400, currencyCode: 'EUR' },
      acquiredAmount: { centAmount: 400, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.REFUNDED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  // A VOID keeps the authorized total as its denominator: it reverses the authorization, not a capture.
  test('a void is still measured against the AUTHORIZED total', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CANCELLED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.cancelled',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-void-1',
      amount: { centAmount: 400, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 400, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.PARTIALLY_CANCELLED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  // A void is measured off the SAME cumulative cancelled figure as a refund — the vendor books both
  // reversal kinds there — so the CANCELLED branch needs its own pair: the downgrade itself, and the
  // boundary where the cumulative figure REACHES the total and must NOT downgrade.
  test('a partial void stays PARTIALLY_CANCELLED: cumulative cancelled < total', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CANCELLED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.cancelled',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-cancel-1',
      amount: { centAmount: 300, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 300, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.PARTIALLY_CANCELLED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  test('the completing void reverses the payment in full: cumulative cancelled == total stays CANCELLED', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CANCELLED);
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.cancelled',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-cancel-2',
      amount: { centAmount: 700, currencyCode: 'EUR' },
      cancelledAmount: { centAmount: 1000, currencyCode: 'EUR' },
      totalAmount: { centAmount: 1000, currencyCode: 'EUR' },
      rawStatus: {},
    });
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.CANCELLED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  test('absent amount fields: a CAPTURED event with no acquired/total stays full CAPTURED', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    const spy = jest.spyOn(stateMachine, 'resolveStateEffect');

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(spy).toHaveBeenCalledWith(PaymentState.CAPTURED);
    expect(res.outcome).toBe('processed');
    spy.mockRestore();
  });

  test('failure rollback: an update rejection releases the marker and rethrows so the route 5xxs', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    const boom = new Error('CT update failed');
    ports.paymentStore.update = jest.fn<typeof ports.paymentStore.update>().mockRejectedValue(boom);

    await expect(handleWebhook(ctx(), { ports, provider })).rejects.toBe(boom);
    expect(ports.markerStore.release).toHaveBeenCalledWith(KEY);
  });

  test('release-failure resilience: a failing release still rethrows the ORIGINAL error and logs', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    const boom = new Error('CT update failed');
    ports.paymentStore.update = jest.fn<typeof ports.paymentStore.update>().mockRejectedValue(boom);
    ports.markerStore.release = jest
      .fn<typeof ports.markerStore.release>()
      .mockRejectedValue(new Error('marker delete failed'));

    await expect(handleWebhook(ctx(), { ports, provider })).rejects.toBe(boom);
    expect(env.logger.error).toHaveBeenCalledTimes(1);
  });

  test('reconciles the CT Payment found by interfaceId (not the payment id) for a full capture', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(fakePayment({ id: 'pay-99', amountPlanned: { centAmount: 1000, currencyCode: 'EUR' } }));

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-99',
        transaction: expect.objectContaining({ amount: { centAmount: 1000, currencyCode: 'EUR' } }),
      }),
    );
    expect(res.outcome).toBe('processed');
  });
});

/**
 * The leg the CREATE call opened. A pay answer the vendor accepted but had not settled recorded a `Pending`
 * leg of the booked kind, keyed on the vendor's operation id; the settling delivery names that same id, so its
 * write must MOVE that leg rather than append a second one beside it. Replayed against the SDK's consolidation
 * rules, because the twin is exactly what a bare mock could not show.
 */
describe('orchestration/handleWebhook: a leg the create call opened', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let env: ReturnType<typeof makeFakeEnv>;
  let store: ReturnType<typeof statefulPaymentStore>;

  const ctx = () => ({ env, storeKey: 'store-1', rawBody: Buffer.from('{}'), token: 'tok-1' });

  /** The payment as the create leg left it: one `Pending` charge under the vendor's operation id, nothing else. */
  const openedCharge = (): unknown =>
    ownedPayment([leg('Charge', 'Pending', 1000, 'op-1')], { custom: { fields: { storeKey: 'store-1' } } });

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    env = makeFakeEnv();
    store = statefulPaymentStore(openedCharge());
    ports.paymentStore = store.port;
  });

  test('payment.captured moves the create-time Charge:Pending to Success in place, one leg', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('processed');
    expect(store.current().transactions).toHaveLength(1);
    expect(store.current().transactions[0]).toMatchObject({ type: 'Charge', state: 'Success', interactionId: 'op-1' });
  });

  test('a refused charge moves the same leg to Failure, not an Authorization:Failure beside it', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.FAILED);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('processed');
    expect(store.current().transactions).toHaveLength(1);
    expect(store.current().transactions[0]).toMatchObject({ type: 'Charge', state: 'Failure', interactionId: 'op-1' });
  });

  test('an accepted-but-unsettled redelivery is still a 200 no-op before the marker, the Pending leg untouched', async () => {
    provider.mapProviderStatus = jest
      .fn<typeof provider.mapProviderStatus>()
      .mockReturnValue(PaymentState.CAPTURE_REQUESTED);

    const res = await handleWebhook(ctx(), { ports, provider });

    expect(res.outcome).toBe('ignored');
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(store.current().transactions[0]).toMatchObject({ type: 'Charge', state: 'Pending', interactionId: 'op-1' });
  });
});
