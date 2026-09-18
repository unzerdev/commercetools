/**
 * The Unzer webhook event registry: one rule per registered event name, and that table is the only source
 * of both the dispatch and the `eventList` the connection subscribes.
 *
 * The pins here are the ones a sandbox would otherwise be the first to fail: that every subscribed name is
 * a real Unzer event name, that the names are unique, that each rule settles the leg its kind claims, and
 * that a name the connector never subscribed costs no vendor read.
 */
import { describe, expect, jest, test } from '@jest/globals';
import type { PspClient, PspConnectionConfig, UnzerPayment, UnzerTransaction } from '../src/providers/psp/client';
import { SUBSCRIBED_EVENTS, UNZER_EVENT_RULES } from '../src/providers/psp/webhook/events';
import { PspWebhookHandler } from '../src/providers/psp/webhook/webhook.handler';
import { storeConfig } from './support/store-config';

/**
 * Unzer's OFFICIAL event enum, copied from the vendor SDK's `Constants/WebhookEvents.php`. Kept here
 * verbatim so a typo or an invented name (`cancel-charge`, `refund` - transaction TYPE names, never
 * event names) fails on this test rather than silently subscribing nothing on a live account.
 */
const UNZER_EVENTS: ReadonlySet<string> = new Set([
  'all',
  'authorize',
  'authorize.succeeded',
  'authorize.failed',
  'authorize.pending',
  'authorize.canceled',
  'authorize.expired',
  'authorize.resumed',
  'preauthorize',
  'preauthorize.succeeded',
  'preauthorize.failed',
  'preauthorize.pending',
  'preauthorize.canceled',
  'preauthorize.expired',
  'preauthorize.resumed',
  'charge',
  'charge.succeeded',
  'charge.failed',
  'charge.pending',
  'charge.canceled',
  'charge.expired',
  'charge.resumed',
  'chargeback',
  'payout',
  'payout.succeeded',
  'payout.failed',
  'types',
  'customer',
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'payment',
  'payment.pending',
  'payment.completed',
  'payment.canceled',
  'payment.partly',
  'payment.payment_review',
  'payment.chargeback',
  'shipment',
]);

const PAYMENT_ID = 's-pay-1';
const base = `https://sbx-api.unzer.com/v1/payments/${PAYMENT_ID}`;

/** One leg of each type the interpretation knows, so a predicate that picks the wrong one is visible. */
const LEGS: Record<string, UnzerTransaction> = {
  authorization: { type: 'authorize', status: 'success', url: `${base}/authorize/s-aut-1`, amount: '15.00' },
  charge: { type: 'charge', status: 'success', url: `${base}/charges/s-chg-1`, amount: '15.00' },
  void: {
    type: 'cancel-authorize',
    status: 'success',
    url: `${base}/authorize/s-aut-1/cancels/s-cnl-1`,
    amount: '15.00',
  },
  refund: { type: 'cancel-charge', status: 'success', url: `${base}/charges/s-chg-1/cancels/s-cnl-2`, amount: '5.00' },
  chargeback: {
    type: 'chargeback',
    status: 'success',
    url: `${base}/charges/s-chg-1/chargebacks/s-cbk-1`,
    amount: '15.00',
  },
};

/** The same five legs under the API reference's generic vocabulary - both must select identically. */
const GENERIC_LEGS: UnzerTransaction[] = [
  { ...LEGS.authorization, type: 'authorization' },
  LEGS.charge,
  { ...LEGS.void, type: 'cancellation' },
  { ...LEGS.refund, type: 'cancellation' },
  LEGS.chargeback,
];

/** A payment carrying EVERY leg kind at once - the fixture that makes leg selection falsifiable. */
const paymentWithEveryLeg: UnzerPayment = {
  id: PAYMENT_ID,
  state: { name: 'completed' },
  currency: 'EUR',
  paymentReference: 'ref',
  transactions: Object.values(LEGS),
};

const fakePayments = (payment: UnzerPayment = paymentWithEveryLeg) =>
  jest.fn<(cfg: PspConnectionConfig, id: string) => Promise<UnzerPayment>>().mockResolvedValue(payment);

const handlerFor = (getPayment: ReturnType<typeof fakePayments>) =>
  new PspWebhookHandler({
    payments: { get: getPayment } as unknown as PspClient['payments'],
    webhooks: {} as unknown as PspClient['webhooks'],
  });

const body = (event: string, retrieveUrl?: string) =>
  Buffer.from(
    JSON.stringify({ event, publicKey: 's-pub-test', paymentId: PAYMENT_ID, ...(retrieveUrl ? { retrieveUrl } : {}) }),
    'utf8',
  );

describe('the Unzer webhook event registry', () => {
  test('every registered name is a real Unzer event name', () => {
    for (const rule of UNZER_EVENT_RULES) {
      expect(UNZER_EVENTS.has(rule.event)).toBe(true);
    }
  });

  // A duplicate would silently drop one rule AND under-subscribe by one event: dispatch is a lookup by
  // exact name, so the second rule for a name could never be reached.
  test('the names are unique', () => {
    const names = UNZER_EVENT_RULES.map((rule) => rule.event);
    expect(new Set(names).size).toBe(names.length);
  });

  // `all` is exactly what the registry replaced: an account-wide subscription made the reconciler's own
  // no-op branch carry the bulk of the account's traffic.
  test('the subscription list IS the registry, and never `all`', () => {
    expect(SUBSCRIBED_EVENTS).toEqual(UNZER_EVENT_RULES.map((rule) => rule.event));
    expect(SUBSCRIBED_EVENTS).not.toContain('all');
  });

  test('registerWebhooks subscribes exactly the registry names against one URL', async () => {
    const register = jest.fn<PspClient['webhooks']['register']>().mockResolvedValue(['wh-1']);
    const handler = new PspWebhookHandler({
      payments: {} as unknown as PspClient['payments'],
      webhooks: { register } as unknown as PspClient['webhooks'],
    });

    await handler.registerWebhooks(storeConfig(), 'https://proc.example/webhooks/store-1/tok');

    expect(register).toHaveBeenCalledWith(expect.anything(), {
      url: 'https://proc.example/webhooks/store-1/tok',
      events: SUBSCRIBED_EVENTS,
    });
  });
});

describe('each event settles the leg its kind claims', () => {
  // The registry as a test: the event name the vendor delivers, the internal kind, and the leg whose id
  // becomes the operation identity. A predicate that picks a sibling leg on this all-leg fixture would
  // record one vendor operation as another kind of CT Transaction.
  // The identity is CHARGE SCOPED wherever the leg names a parent charge: Unzer numbers a cancellation
  // (and a chargeback) within it, so two refunds of one payment would otherwise share `s-cnl-1`. A void
  // hangs off the authorization and has no charge to scope it to, so it stays bare.
  test.each([
    ['authorize.succeeded', 'payment.pending_capture', 's-aut-1'],
    ['authorize.failed', 'payment.pending_capture', 's-aut-1'],
    ['authorize.canceled', 'payment.cancelled', 's-cnl-1'],
    ['charge.succeeded', 'payment.captured', 's-chg-1'],
    ['charge.failed', 'payment.captured', 's-chg-1'],
    ['charge.canceled', 'payment.refunded', 's-chg-1.s-cnl-2'],
    ['chargeback', 'payment.chargeback', 's-chg-1.s-cbk-1'],
  ])('%s → %s settling leg %s', async (event, kind, operationId) => {
    const getPayment = fakePayments();

    const parsed = await handlerFor(getPayment).parse(body(event), storeConfig());

    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({ kind, operationId, paymentRef: 'ref', providerPaymentId: PAYMENT_ID });
  });
});

describe('both of the vendor leg vocabularies', () => {
  // Unzer speaks two vocabularies for the same leg: a live payment read answers with the transaction-type
  // names (`cancel-charge`), the API reference describes the generic shapes (`cancellation`). Selection
  // must not depend on which one arrived - it did, and the live one selected nothing at all.
  test.each([
    ['authorize.canceled', 's-cnl-1'],
    ['charge.canceled', 's-chg-1.s-cnl-2'],
    ['authorize.succeeded', 's-aut-1'],
  ])('%s selects the same leg under the generic vocabulary', async (event, operationId) => {
    const getPayment = fakePayments({ ...paymentWithEveryLeg, transactions: GENERIC_LEGS });

    const parsed = await handlerFor(getPayment).parse(body(event), storeConfig());

    expect(parsed.operationId).toBe(operationId);
  });
});

describe('the reconciliation anchors', () => {
  // Unzer's payment resource carries the merchant reference only on the per-leg read, so the payment a
  // notification fetches routinely echoes none. `orderId` - the commercetools Payment id the charge
  // stamped - is what the payment read DOES echo, so both are emitted and the reconciler prefers the
  // reference when it is there.
  test('emits the merchant reference AND the platform payment id the payment echoes', async () => {
    const getPayment = fakePayments({ ...paymentWithEveryLeg, orderId: 'ct-pay-1' });

    const parsed = await handlerFor(getPayment).parse(body('charge.succeeded'), storeConfig());

    expect(parsed).toMatchObject({ paymentRef: 'ref', platformPaymentId: 'ct-pay-1' });
  });

  test('omits the platform payment id when the payment carries no orderId', async () => {
    const getPayment = fakePayments();

    const parsed = await handlerFor(getPayment).parse(body('charge.succeeded'), storeConfig());

    expect(parsed.platformPaymentId).toBeUndefined();
  });
});

describe('an unregistered event name', () => {
  // Dispatch is an EXACT match, so the bare operations and the halves the connector deliberately does not
  // subscribe are noise: no vendor read, and the raw name is kept so the operator's log names what arrived.
  test.each(['charge', 'authorize', 'charge.pending', 'payment.completed', 'types', ''])(
    '%s is a bare envelope with no vendor read',
    async (event) => {
      const getPayment = fakePayments();

      const parsed = await handlerFor(getPayment).parse(body(event), storeConfig());

      expect(getPayment).not.toHaveBeenCalled();
      expect(parsed).toEqual({
        kind: event,
        paymentRef: '',
        providerPaymentId: '',
        operationId: '',
        rawStatus: { state: '' },
      });
    },
  );

  // A registered name that carries no payment id (an account-level delivery) takes the same free path.
  test('a registered name naming no payment costs no vendor read either', async () => {
    const getPayment = fakePayments();
    const raw = Buffer.from(JSON.stringify({ event: 'charge.succeeded', publicKey: 's-pub-test' }), 'utf8');

    const parsed = await handlerFor(getPayment).parse(raw, storeConfig());

    expect(getPayment).not.toHaveBeenCalled();
    expect(parsed.paymentRef).toBe('');
  });
});

describe('two cancellations that share a trailing segment', () => {
  // Unzer numbers a cancellation WITHIN its parent charge, so the two slices of one split refund both come
  // back as `s-cnl-1`. Selected on that segment alone, the notification for the second slice picks the
  // FIRST slice's leg: it takes the wrong amount, stamps an operation id that is already recorded, and is
  // then swallowed as a redelivery - the second refund never settles and the payment silently disagrees
  // with the vendor about how much went back.
  const splitRefund: UnzerTransaction[] = [
    { type: 'charge', status: 'success', url: `${base}/charges/c1`, amount: '50.00' },
    { type: 'charge', status: 'success', url: `${base}/charges/c2`, amount: '50.00' },
    { type: 'cancel-charge', status: 'success', url: `${base}/charges/c1/cancels/s-cnl-1`, amount: '50.00' },
    { type: 'cancel-charge', status: 'success', url: `${base}/charges/c2/cancels/s-cnl-1`, amount: '40.00' },
  ];

  test.each([
    ['c1', 'c1.s-cnl-1', 5000],
    ['c2', 'c2.s-cnl-1', 4000],
  ])('the delivered url picks the cancellation on charge %s', async (chargeId, operationId, centAmount) => {
    const getPayment = fakePayments({ ...paymentWithEveryLeg, transactions: splitRefund });

    const parsed = await handlerFor(getPayment).parse(
      body('charge.canceled', `${base}/charges/${chargeId}/cancels/s-cnl-1`),
      storeConfig(),
    );

    expect(parsed.operationId).toBe(operationId);
    expect(parsed.amount?.centAmount).toBe(centAmount);
  });
});
