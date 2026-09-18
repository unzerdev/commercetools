/**
 * The webhook reconciliation contract: the REAL `PspWebhookHandler` driven
 * through `handleWebhook` over fake ports, with the Unzer `getPayment` transport faked and the REAL
 * capability-URL token functions gating the request. An Unzer webhook carries only a resource URL /
 * payment id, not the state — so the handler reads the authoritative payment ONCE and reconciles it
 * by the merchant reference that payment echoes.
 *
 * Two pins: (a) a request under the store's own derived token is accepted, reads the payment exactly
 * once, and reflects the Transaction onto the CT Payment; (b) an absent/wrong token fails CLOSED —
 * no read, no write.
 */
import { describe, expect, jest, test } from '@jest/globals';
import type { PspClient, PspConnectionConfig, UnzerPayment } from '../src/providers/psp/client';
import { verifyWebhookUrlToken, webhookUrlToken } from '../src/infrastructure/crypto/crypto';
import { PspWebhookHandler } from '../src/providers/psp/webhook/webhook.handler';
import { mapProviderStatus } from '../src/providers/psp/status';
import { handleWebhook } from '../src/application/orchestration';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { useEncryptionKeyring } from './support/webhook-token';

// The test keyring the REAL token functions derive from (64-hex → the 32 raw key bytes verbatim),
// pinned for the suite and restored afterwards so no key leaks between suites.
useEncryptionKeyring('d'.repeat(64));

/** A minimal Unzer webhook envelope: the event name plus the resource URL / payment id, no state. */
const ENVELOPE = Buffer.from(
  JSON.stringify({
    event: 'charge.succeeded',
    publicKey: 's-pub-test',
    paymentId: 's-pay-1',
    retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
  }),
  'utf8',
);

/**
 * The authoritative payment the faked `getPayment` returns — the state, the echoed merchant reference, and
 * the CHARGE LEG the envelope's `retrieveUrl` points at. The leg is not decoration: the operation identity
 * the reconciler records is read off a leg's own `url` on this payment, so a fixture without any
 * leg of the event's kind would exercise the nothing-to-settle no-op rather than the settlement path.
 */
const authoritativePayment: UnzerPayment = {
  id: 's-pay-1',
  state: { id: 1, name: 'completed' },
  paymentReference: 'ref',
  transactions: [
    {
      type: 'charge',
      status: 'success',
      url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
      amount: '15.00',
    },
  ],
};

/** Wire the real webhook handler (with a faked `getPayment`) + the real status map into a fake module. */
function providerWith(getPayment: jest.Mock<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>) {
  const provider = makeFakeProviderModule();
  provider.webhook = new PspWebhookHandler({
    payments: { get: getPayment } as unknown as PspClient['payments'],
    webhooks: {
      register: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
      delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as PspClient['webhooks'],
  });
  provider.mapProviderStatus = mapProviderStatus;
  return provider;
}

/** Fake ports with the REAL token check in place of the always-true stub. */
function portsWithRealTokenGate() {
  const ports = makeFakePorts();
  ports.crypto.verifyWebhookUrlToken = jest
    .fn<typeof ports.crypto.verifyWebhookUrlToken>()
    .mockImplementation(verifyWebhookUrlToken);
  return ports;
}

describe('webhook reconciliation (real handler + real token gate, faked getPayment)', () => {
  test("(a) the store's own token: reads the payment once and reconciles the CT Payment", async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: ENVELOPE, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledWith(expect.anything(), 's-pay-1');
    // Reconciled by the merchant reference the authoritative payment echoes, scoped to the route store.
    expect(ports.paymentStore.findByMerchantReference).toHaveBeenCalledWith('ref', 'store-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-1',
        pspReference: 's-pay-1',
        transaction: expect.objectContaining({ type: 'Charge', state: 'Success', interactionId: 's-chg-1' }),
      }),
    );
    expect(res.outcome).toBe('processed');
  });

  /**
   * A body that is not JSON at all, or is JSON but not an object, can NEVER become a settlement: the vendor
   * is retrying bytes no version of this connector could read. Answered as noise with no vendor read, so
   * the delivery is acknowledged instead of 5xx-ing the route into indefinite redelivery of a broken body.
   */
  test.each([
    ['a body that is not JSON', Buffer.from('<html>gateway error</html>', 'utf8')],
    ['a JSON array', Buffer.from('[]', 'utf8')],
    ['a JSON string', Buffer.from('"charge.succeeded"', 'utf8')],
    ['an empty body', Buffer.alloc(0)],
  ])('%s is ignored without a vendor read, never a redelivery loop', async (_label, rawBody) => {
    const getPayment = jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>();
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  /**
   * A live sandbox account delivers OUTCOME-SUFFIXED event names, and those exact names are
   * what the connection now subscribes and the registry dispatches on. The bare operation `charge` is NOT
   * among them: it is never subscribed, so it is noise the reconciler drops for free (see the
   * unsubscribed-name cases below) rather than a settlement the prefix rule used to admit.
   */
  test.each([
    ['charge.succeeded', 'Charge'],
    ['charge.failed', 'Charge'],
  ])('a %s notification reconciles as a %s settlement', async (event, transactionType) => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event,
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ type: transactionType, state: 'Success', interactionId: 's-chg-1' }),
      }),
    );
  });

  // The authorize-booking half of the same fix: `authorize.succeeded` is the ONLY settlement such a
  // payment ever gets, so an unmapped one left the authorization unreflected on the CT Payment.
  test('an authorize.succeeded notification reconciles as an Authorization settlement', async () => {
    const authorized: UnzerPayment = {
      id: 's-pay-1',
      state: { id: 1, name: 'pending' },
      paymentReference: 'ref',
      transactions: [
        {
          type: 'authorization',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1',
          amount: '15.00',
        },
      ],
    };
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authorized);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'authorize.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ type: 'Authorization', state: 'Success', interactionId: 's-aut-1' }),
      }),
    );
  });

  // Dispatch is an EXACT match on the registered name, so every name the connector did not
  // subscribe stays free — including the BARE operations (`charge`, `authorize`) and the `*.pending`
  // halves the old prefix rule admitted. Admitting a pending notification would spend a vendor read per
  // delivery and interpret a payment fetched for an event with nothing to settle.
  test.each([
    'payment.pending',
    'basket.created',
    'customer.updated',
    'types',
    'charge',
    'authorize',
    'charge.pending',
    'payment.completed',
  ])('the non-settlement event %s is still ignored WITHOUT a vendor read', async (event) => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(JSON.stringify({ event, publicKey: 's-pub-test', paymentId: 's-pay-1' }), 'utf8');

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // The connection subscribes only the names the registry holds a handler for, but the vendor can still
  // deliver outside that set — a stale `all` subscription from an earlier connect, a redelivery of an
  // event since unsubscribed. An unregistered name maps to no settlement kind, so the reconciler ignores
  // it without a read: reading
  // the payment first would spend a vendor call per notification for nothing, and a payment whose
  // `state.name` is outside the interpreted set would make the interpretation THROW, 5xx the route and
  // put the vendor into indefinite redelivery of an event that has nothing to reconcile.
  test('a non-settlement event is ignored WITHOUT a vendor read', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'types',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/types/card/s-crd-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // A SETTLEMENT event name that names no payment (an account-level notification the vendor fires under
  // an operation name) still maps to a handled kind, so the kind gate lets it through — and the bare
  // envelope it produces carries no reconciliation anchor. Without a second gate it costs three
  // commercetools calls (marker claim + payment query + marker release) and claims a DEPLOYMENT-GLOBAL
  // marker key, since the composite degenerates to `~payment.captured~` for every such delivery.
  test('a settlement event naming no payment is dropped before the marker: no CT write of any kind', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(JSON.stringify({ event: 'charge.succeeded', publicKey: 's-pub-test' }), 'utf8');

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.findByMerchantReference).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // A refund and a void are BOTH `cancellation` legs in Unzer's vocabulary, told apart only by what the
  // leg's own url says it reversed (`reversesAuthorization`, the provider's ONE discriminator). Selecting on
  // the type alone lets a void notification settle a refund's leg: the CT types differ (`CancelAuthorization`
  // vs `Refund`), so the identity guard cannot see the collision, and one vendor cancellation becomes two
  // reversal Transactions.
  const refundLegPayment: UnzerPayment = {
    id: 's-pay-1',
    state: { id: 1, name: 'completed' },
    paymentReference: 'ref',
    currency: 'EUR',
    transactions: [
      {
        type: 'cancellation',
        status: 'success',
        // A cancellation of a CHARGE — a refund.
        url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-refund',
        amount: '4.00',
      },
    ],
  };

  /**
   * The real-account case that made every settlement fall through: Unzer's payment resource does NOT echo
   * the merchant reference - it comes back only on the per-leg read - so a live refund arrives with
   * `paymentReference` absent. The connector also stamps the commercetools Payment id as the vendor
   * `orderId`, and the payment read DOES echo that, so it is the anchor the reconciliation falls back to:
   * a direct load by id rather than a query by custom field.
   */
  describe('the payment echoes no merchant reference', () => {
    /** A real sandbox refund body, verbatim: no reference anywhere, only the leg the cancellation booked. */
    const REFUND_ENVELOPE = Buffer.from(
      JSON.stringify({
        event: 'charge.canceled',
        publicKey: 's-pub-test',
        retrieveUrl: 'https://api.test.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-2',
        paymentId: 's-pay-12685',
      }),
      'utf8',
    );

    /** The authoritative payment as Unzer really answers it: an `orderId`, and NO `paymentReference`. */
    const referencelessPayment: UnzerPayment = {
      id: 's-pay-12685',
      state: { id: 1, name: 'completed' },
      orderId: 'pay-1',
      currency: 'EUR',
      amount: { total: '15.00', charged: '15.00', canceled: '15.00' },
      transactions: [
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://api.test.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-2',
          amount: '15.00',
        },
      ],
    };

    const refundProvider = () =>
      providerWith(
        jest
          .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
          .mockResolvedValue(referencelessPayment),
      );

    test('reconciles by the echoed platform payment id and records Refund:Success', async () => {
      const provider = refundProvider();
      const ports = portsWithRealTokenGate();
      ports.paymentStore.findById = jest
        .fn<typeof ports.paymentStore.findById>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'store-1' } } }));

      const res = await handleWebhook(
        { env: makeFakeEnv(), storeKey: 'store-1', rawBody: REFUND_ENVELOPE, token: webhookUrlToken('store-1') },
        { ports, provider },
      );

      expect(res.outcome).toBe('processed');
      // No merchant reference to query by — the id is loaded directly.
      expect(ports.paymentStore.findByMerchantReference).not.toHaveBeenCalled();
      expect(ports.paymentStore.findById).toHaveBeenCalledWith('pay-1');
      expect(ports.paymentStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pay-1',
          pspReference: 's-pay-12685',
          transaction: expect.objectContaining({ type: 'Refund', state: 'Success', interactionId: 's-chg-1.s-cnl-2' }),
        }),
      );
    });

    // The by-id load has no store scope of its own, so the guard the scoped query gave for free must be
    // re-imposed: an event admitted under one store's token must not settle another store's Payment.
    test("never settles a payment stamped with a DIFFERENT store than the token's", async () => {
      const provider = refundProvider();
      const ports = portsWithRealTokenGate();
      ports.paymentStore.findById = jest
        .fn<typeof ports.paymentStore.findById>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'store-other' } } }));

      const res = await handleWebhook(
        { env: makeFakeEnv(), storeKey: 'store-1', rawBody: REFUND_ENVELOPE, token: webhookUrlToken('store-1') },
        { ports, provider },
      );

      expect(res.outcome).toBe('ignored');
      expect(ports.paymentStore.update).not.toHaveBeenCalled();
      // The marker is released, so the store that DOES own the payment can still process a redelivery.
      expect(ports.markerStore.release).toHaveBeenCalled();
    });

    test('a payment echoing NEITHER anchor is dropped before the marker', async () => {
      const provider = providerWith(
        jest
          .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
          .mockResolvedValue({ ...referencelessPayment, orderId: undefined }),
      );
      const ports = portsWithRealTokenGate();

      const res = await handleWebhook(
        { env: makeFakeEnv(), storeKey: 'store-1', rawBody: REFUND_ENVELOPE, token: webhookUrlToken('store-1') },
        { ports, provider },
      );

      expect(res.outcome).toBe('ignored');
      expect(ports.markerStore.claim).not.toHaveBeenCalled();
      expect(ports.paymentStore.findById).not.toHaveBeenCalled();
      expect(ports.paymentStore.update).not.toHaveBeenCalled();
    });
  });

  /**
   * A LIVE sandbox payment, captured verbatim from `GET /v1/payments/s-pay-12685` after four partial
   * refunds through the Unzer portal. It is the fixture the authored ones were wrong about on three counts
   * at once, each of which alone silently dropped the settlement:
   *   - the refund legs are typed `cancel-charge`, not the `cancellation` the code matched on;
   *   - the payment echoes NO `paymentReference`, only the `orderId` the charge stamped;
   *   - the vendor DECREMENTS `amount.charged` as refunds settle, so `charged` is not the captured total.
   */
  describe('a live Unzer payment with portal refunds', () => {
    const livePayment: UnzerPayment = {
      id: 's-pay-12685',
      state: { id: 1, name: 'completed' },
      amount: { total: '2645.9900', charged: '2466.9900', canceled: '179.0000' },
      currency: 'EUR',
      orderId: 'c948cdb6-771c-47e1-9e70-af81320b7392',
      transactions: [
        {
          date: '2026-09-03 12:42:29',
          type: 'charge',
          status: 'success',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1',
          amount: '2645.9900',
        },
        {
          date: '2026-09-03 12:45:23',
          type: 'cancel-charge',
          status: 'success',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-1',
          amount: '176.0000',
        },
        {
          date: '2026-09-03 12:48:19',
          type: 'cancel-charge',
          status: 'success',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-2',
          amount: '1.0000',
        },
      ],
    };

    /** The delivery Unzer really sends for a portal refund: a pointer, and nothing else. */
    const liveEnvelope = (cancelId: string) =>
      Buffer.from(
        JSON.stringify({
          event: 'charge.canceled',
          publicKey: 's-pub-test',
          retrieveUrl: `https://api.test.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/${cancelId}`,
          paymentId: 's-pay-12685',
        }),
        'utf8',
      );

    const liveProvider = () =>
      providerWith(
        jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue(livePayment),
      );

    test('settles the cancel-charge leg the delivery points at, under that leg own id and amount', async () => {
      const provider = liveProvider();
      const ports = portsWithRealTokenGate();
      ports.paymentStore.findById = jest
        .fn<typeof ports.paymentStore.findById>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'store-1' } } }));

      const res = await handleWebhook(
        {
          env: makeFakeEnv(),
          storeKey: 'store-1',
          rawBody: liveEnvelope('s-cnl-2'),
          token: webhookUrlToken('store-1'),
        },
        { ports, provider },
      );

      expect(res.outcome).toBe('processed');
      expect(ports.paymentStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pay-1',
          pspReference: 's-pay-12685',
          transaction: expect.objectContaining({
            type: 'Refund',
            state: 'Success',
            // THIS refund's own delta, never the payment total and never the sibling refund's 176.00.
            amount: expect.objectContaining({ centAmount: 100, currencyCode: 'EUR' }),
            // Charge scoped — the vendor numbers a cancellation within its parent charge.
            interactionId: 's-chg-1.s-cnl-2',
          }),
        }),
      );
    });

    // Each portal refund is its own leg with its own id, so the second one is NEW information rather than a
    // redelivery of the first - the marker key and the redelivery guard both key on that id.
    test('a sibling refund on the same payment settles under its own identity', async () => {
      const provider = liveProvider();
      const ports = portsWithRealTokenGate();
      ports.paymentStore.findById = jest
        .fn<typeof ports.paymentStore.findById>()
        .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'store-1' } } }));

      await handleWebhook(
        {
          env: makeFakeEnv(),
          storeKey: 'store-1',
          rawBody: liveEnvelope('s-cnl-1'),
          token: webhookUrlToken('store-1'),
        },
        { ports, provider },
      );

      expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-12685~payment.refunded~s-chg-1.s-cnl-1');
      expect(ports.paymentStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            interactionId: 's-chg-1.s-cnl-1',
            amount: { centAmount: 17600, currencyCode: 'EUR' },
          }),
        }),
      );
    });
  });

  /**
   * The shopper's bank reversed settled funds. The connector subscribes `chargeback` and the
   * whole chain must carry it end to end: the chargeback leg is selected, `CHARGEBACK` is interpreted off
   * it, and commercetools records the reversal as the `Refund` it has no other type for.
   */
  test('a chargeback notification settles the chargeback leg and records Refund:Success', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'chargeback' },
        paymentReference: 'ref',
        currency: 'EUR',
        transactions: [
          {
            type: 'charge',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
            amount: '15.00',
          },
          {
            type: 'chargeback',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/chargebacks/s-cbk-1',
            amount: '15.00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'chargeback',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/chargebacks/s-cbk-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          type: 'Refund',
          state: 'Success',
          // A chargeback hangs off the charge it reverses, so it is scoped like a refund.
          interactionId: 's-chg-1.s-cbk-1',
        }),
      }),
    );
  });

  test('a void notification never settles a refund leg', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue(refundLegPayment),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'authorize.canceled',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-void',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('a refund notification never settles a void leg', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'canceled' },
        paymentReference: 'ref',
        currency: 'EUR',
        transactions: [
          {
            type: 'cancellation',
            status: 'success',
            // A cancellation of an AUTHORIZATION — a void.
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-void',
            amount: '6.00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.canceled',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-refund',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // A cancellation the vendor is still processing has settled NOTHING. Interpreting it from the payment's
  // coarse state answers about the PAYMENT, not the operation: a pending refund on a captured payment reads
  // as CAPTURED and would record a second `Charge:Success` under the cancellation's id, and a pending void on
  // an authorized payment reads as AUTHORIZED and would record an `Authorization:Success` for money that is
  // being released. Both must be no-ops that keep no marker, so the settling delivery still lands.
  test('a PENDING refund leg settles nothing and keeps no marker', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'completed' },
        paymentReference: 'ref',
        currency: 'EUR',
        amount: { total: '10.00', charged: '10.00' },
        transactions: [
          {
            type: 'charge',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
            amount: '10.00',
          },
          {
            type: 'cancellation',
            status: 'pending',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-refund',
            amount: '4.00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.canceled',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-refund',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
  });

  test('a PENDING void leg settles nothing and keeps no marker', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'pending' },
        paymentReference: 'ref',
        currency: 'EUR',
        amount: { total: '10.00' },
        transactions: [
          {
            type: 'authorization',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1',
            amount: '10.00',
          },
          {
            type: 'cancellation',
            status: 'pending',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-void',
            amount: '10.00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'authorize.canceled',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-void',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
  });

  // A payment carrying BOTH reversal flavours is where selecting on the leg type alone did its damage: one
  // vendor cancellation became two CT reversal Transactions. Each notification must settle its own flavour.
  test('a payment with both reversal legs settles each under its own notification', async () => {
    const bothReversals: UnzerPayment = {
      id: 's-pay-1',
      state: { id: 1, name: 'completed' },
      paymentReference: 'ref',
      currency: 'EUR',
      amount: { total: '10.00', charged: '10.00', canceled: '10.00' },
      transactions: [
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-refund',
          amount: '4.00',
        },
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-void',
          amount: '6.00',
        },
      ],
    };
    const envelopeFor = (event: string, ref: string) =>
      Buffer.from(JSON.stringify({ event, publicKey: 's-pub-test', paymentId: 's-pay-1', retrieveUrl: ref }), 'utf8');

    const refundPorts = portsWithRealTokenGate();
    await handleWebhook(
      {
        env: makeFakeEnv(),
        storeKey: 'store-1',
        rawBody: envelopeFor('charge.canceled', 'https://sbx-api.unzer.com/v1/payments/s-pay-1'),
        token: webhookUrlToken('store-1'),
      },
      {
        ports: refundPorts,
        provider: providerWith(
          jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue(bothReversals),
        ),
      },
    );

    // The refund notification takes the refund leg's id and its own 400 — never the void's 600.
    expect(refundPorts.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          type: 'Refund',
          interactionId: 's-chg-1.s-cnl-refund',
          amount: { centAmount: 400, currencyCode: 'EUR' },
        }),
      }),
    );

    const voidPorts = portsWithRealTokenGate();
    await handleWebhook(
      {
        env: makeFakeEnv(),
        storeKey: 'store-1',
        rawBody: envelopeFor('authorize.canceled', 'https://sbx-api.unzer.com/v1/payments/s-pay-1'),
        token: webhookUrlToken('store-1'),
      },
      {
        ports: voidPorts,
        provider: providerWith(
          jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue(bothReversals),
        ),
      },
    );

    expect(voidPorts.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          type: 'CancelAuthorization',
          interactionId: 's-cnl-void',
          amount: { centAmount: 600, currencyCode: 'EUR' },
        }),
      }),
    );
  });

  // The parent discriminator must read the PATH: a query string or an origin containing `/authorize/` is
  // not a statement about what the leg reversed.
  test('a refund leg whose QUERY mentions authorize is still a refund', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'completed' },
        paymentReference: 'ref',
        currency: 'EUR',
        transactions: [
          {
            type: 'cancellation',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-1?ref=/authorize/x',
            amount: '4.00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.canceled',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ type: 'Refund' }) }),
    );
  });

  // The fallback must name the NEWEST leg of the kind, which is what the vendor booked last — array order is
  // not that guarantee, and the leg carries its own `date`.
  test('the fallback settles the newest leg of the kind, not the last in array order', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'completed' },
        paymentReference: 'ref',
        currency: 'EUR',
        transactions: [
          {
            type: 'charge',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-new',
            amount: '6.00',
            date: '2026-07-03 12:00:00',
          },
          {
            type: 'charge',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-old',
            amount: '4.00',
            date: '2026-07-03 09:00:00',
          },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1',
      }),
      'utf8',
    );

    await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-new');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ amount: { centAmount: 600, currencyCode: 'EUR' } }),
      }),
    );
  });

  // A leg with no `url` has no id, so it can name no operation. Preferring it over a leg that HAS one would
  // drop every settlement notification for that payment.
  test('a leg without a url is skipped in favour of one that carries an id', async () => {
    const provider = providerWith(
      jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
        id: 's-pay-1',
        state: { id: 1, name: 'completed' },
        paymentReference: 'ref',
        currency: 'EUR',
        transactions: [
          {
            type: 'charge',
            status: 'success',
            url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
            amount: '10.00',
          },
          { type: 'charge', status: 'success', amount: '10.00' },
        ],
      }),
    );
    const ports = portsWithRealTokenGate();
    // A payment-level reference, so the FALLBACK runs — the url-less leg is the array-last candidate.
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1',
      }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-1');
  });

  // No leg of the event's own kind on the fetched payment means the vendor has not booked the operation
  // this notification claims — there is nothing to reflect and no identity to reflect it under. The
  // vendor's own reference integration behaves the same way: an operation with no id is not booked at all.
  test('no leg of the event kind on the payment: nothing is reconciled and no marker is claimed', async () => {
    const getPayment = jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
      id: 's-pay-1',
      state: { id: 1, name: 'completed' },
      paymentReference: 'ref',
      currency: 'EUR',
      // An authorization only: the `charge` notification below claims a capture the payment does not carry.
      transactions: [
        {
          type: 'authorization',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1',
          amount: '15.00',
        },
      ],
    });
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: ENVELOPE, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // An uninterpretable payment state is a REAL fault worth a 5xx — but only on an event the reconciler
  // acts on, where redelivery can still land the settlement once the state advances.
  test('an unmapped event about a payment in an uninterpretable state never reaches the interpretation', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue({ id: 's-pay-1', state: { id: 0, name: 'create' }, paymentReference: 'ref' });
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({ event: 'payment', publicKey: 's-pub-test', paymentId: 's-pay-1' }),
      'utf8',
    );

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('ignored');
    expect(getPayment).not.toHaveBeenCalled();
  });

  // The operation identity is the ONE envelope field a delivered body could dictate: it becomes the
  // marker key's third segment AND the Transaction's `interactionId`, the identity the redelivery guard
  // recognises. So it is read off the FETCHED payment's own leg, never taken from the body: the delivered
  // `retrieveUrl` only SELECTS a leg. A reference matching no leg leaves the settlement under the
  // payment's own newest leg of that kind — an identity the vendor booked and the guard recognises — so an
  // invented reference cannot mint a second Success transaction beside the real one.
  const envelopeFor = (operationRef: string) =>
    Buffer.from(
      JSON.stringify({
        event: 'charge.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: `https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/${operationRef}`,
      }),
      'utf8',
    );

  test('a reference matching a leg reflects under THAT leg id', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelopeFor('s-chg-1'), token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ interactionId: 's-chg-1' }) }),
    );
  });

  test("a reference matching no leg settles the payment's own newest leg of that kind", async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      {
        env: makeFakeEnv(),
        storeKey: 'store-1',
        rawBody: envelopeFor('s-chg-INVENTED'),
        token: webhookUrlToken('store-1'),
      },
      { ports, provider },
    );

    expect(res.outcome).toBe('processed');
    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ interactionId: 's-chg-1' }) }),
    );
  });

  // The attack the binding closes: the genuine settlement is already reflected under its LEG id, and a
  // holder of the capability URL reposts the same event with an invented reference. Taken from the body
  // that reference is an identity the redelivery guard has never seen, so a SECOND full-amount
  // Charge:Success lands beside the real one — the same 1500 counted twice.
  test('an invented reference cannot append a second success beside the leg-keyed reflection', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    ports.paymentStore.findByMerchantReference = jest
      .fn<typeof ports.paymentStore.findByMerchantReference>()
      .mockResolvedValue(
        fakePayment({
          transactions: [
            {
              type: 'Charge',
              state: 'Success',
              interactionId: 's-chg-1',
              amount: { centAmount: 1500, currencyCode: 'EUR' },
            },
          ],
        }),
      );

    const res = await handleWebhook(
      {
        env: makeFakeEnv(),
        storeKey: 'store-1',
        rawBody: envelopeFor('s-chg-ANOTHER-INVENTION'),
        token: webhookUrlToken('store-1'),
      },
      { ports, provider },
    );

    expect(res.outcome).toBe('duplicate');
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  // Selecting a leg by its url tail ALONE lets a body point a charge event at the payment's own
  // cancellation leg: every value is one the vendor's `getPayment` returned, so nothing looks invented,
  // yet the settlement would be reflected as a Charge under the cancellation's identity. The leg must
  // therefore match the event's own kind — a `charge` event settles a `charge` leg, nothing else.
  test('a charge event cannot select a cancellation leg, whatever the delivered reference says', async () => {
    const getPayment = jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
      id: 's-pay-1',
      state: { id: 1, name: 'completed' },
      paymentReference: 'ref',
      transactions: [
        {
          type: 'charge',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1',
          amount: '15.00',
        },
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-1',
          amount: '5.00',
        },
      ],
    });
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-1',
      }),
      'utf8',
    );

    await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    // The cancellation's id never becomes a Charge's identity: the payment's own charge leg settles.
    expect(ports.markerStore.claim).not.toHaveBeenCalledWith('s-pay-1~payment.captured~s-cnl-1');
    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-1');
  });

  // Two legs of DIFFERENT types can share a trailing segment (the vendor numbers each resource family
  // separately). The event's kind is what decides which of the two settled.
  test('legs sharing a tail are told apart by the kind: a charge event takes the charge leg', async () => {
    const getPayment = jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue({
      id: 's-pay-1',
      state: { id: 1, name: 'completed' },
      paymentReference: 'ref',
      // The leg amounts are read at the PAYMENT's currency exponent, so the currency is what makes the
      // selected leg's own amount observable at all.
      currency: 'EUR',
      transactions: [
        {
          type: 'authorization',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-dup',
          amount: '15.00',
        },
        {
          type: 'charge',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-dup',
          amount: '7.00',
        },
      ],
    });
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    await handleWebhook(
      {
        env: makeFakeEnv(),
        storeKey: 'store-1',
        rawBody: Buffer.from(
          JSON.stringify({
            event: 'charge.succeeded',
            publicKey: 's-pub-test',
            paymentId: 's-pay-1',
            retrieveUrl: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-dup',
          }),
          'utf8',
        ),
        token: webhookUrlToken('store-1'),
      },
      { ports, provider },
    );

    // The charge leg's own 700, not the authorization leg's 1500.
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          interactionId: 's-dup',
          amount: { centAmount: 700, currencyCode: 'EUR' },
        }),
      }),
    );
  });

  // A host-only resource URL has no path, so it selects nothing — the payment's own newest leg of the kind
  // settles, and the host name never becomes an identity.
  test("a host-only retrieveUrl settles the payment's newest leg rather than naming the host", async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();
    const envelope = Buffer.from(
      JSON.stringify({
        event: 'charge.succeeded',
        publicKey: 's-pub-test',
        paymentId: 's-pay-1',
        retrieveUrl: 'https://sbx-api.unzer.com',
      }),
      'utf8',
    );

    await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: envelope, token: webhookUrlToken('store-1') },
      { ports, provider },
    );

    expect(ports.markerStore.claim).toHaveBeenCalledWith('s-pay-1~payment.captured~s-chg-1');
  });

  test('(b) absent token: fails closed — the payment is never read and nothing is written', async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: ENVELOPE, token: '' },
      { ports, provider },
    );

    expect(res.outcome).toBe('unauthorized');
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test("(b) wrong token: another store's derivation fails closed — no CT resolve, no read, no write", async () => {
    const getPayment = jest
      .fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>()
      .mockResolvedValue(authoritativePayment);
    const provider = providerWith(getPayment);
    const ports = portsWithRealTokenGate();

    const res = await handleWebhook(
      { env: makeFakeEnv(), storeKey: 'store-1', rawBody: ENVELOPE, token: webhookUrlToken('store-2') },
      { ports, provider },
    );

    expect(res.outcome).toBe('unauthorized');
    // The gate is pure compute before any I/O: even the store config is never resolved.
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(getPayment).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });
});
