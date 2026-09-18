import { describe, expect, it } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { PspError } from '../src/providers/psp';
import { mapProviderStatus } from '../src/providers/psp/status';
import { unzerOperationStatus, unzerPaymentStatus, unzerWebhookStatus } from '../src/providers/psp/status';
import type { UnzerPayment, UnzerTransaction } from '../src/providers/psp/client';

/**
 * The interpreter turns a REAL Unzer payment resource (`state.name` ∈ pending / completed / canceled /
 * partly / payment_review / chargeback, plus the per-leg `success`/`pending`/`error` outcomes) into the
 * connector's INTERNAL status vocabulary that `STATUS_TABLE` already knows. Every case asserts the round
 * trip through `mapProviderStatus`, because the interpreter's only job is to feed that table a string it
 * can map - a Real Unzer state fed raw (`completed`, `payment_review`, …) makes `mapProviderStatus` throw.
 */
describe('unzerPaymentStatus - Unzer payment resource → internal status vocabulary', () => {
  const map = (payment: UnzerPayment, bookingMode?: 'charge' | 'authorize') =>
    mapProviderStatus({ state: unzerPaymentStatus(payment, bookingMode) });

  it('a completed payment with a succeeded charge leg → CAPTURED', () => {
    const payment: UnzerPayment = {
      id: 's-pay-1',
      state: { name: 'completed' },
      currency: 'EUR',
      transactions: [
        { type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/c1' },
      ],
    };
    expect(map(payment)).toBe(PaymentState.CAPTURED);
  });

  it('an authorize with only a succeeded authorization leg and nothing charged → AUTHORIZED', () => {
    const payment: UnzerPayment = {
      id: 's-pay-2',
      state: { name: 'pending' },
      currency: 'EUR',
      transactions: [
        { type: 'authorization', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-2/authorize/a1' },
      ],
    };
    expect(map(payment, 'authorize')).toBe(PaymentState.AUTHORIZED);
  });

  it('a payment_review payment → IN_REVIEW (fraud/manual review holds it)', () => {
    expect(map({ id: 's-pay-3', state: { name: 'payment_review' } })).toBe(PaymentState.IN_REVIEW);
  });

  it('a declined charge (errored leg, nothing settled) → FAILED', () => {
    const payment: UnzerPayment = {
      id: 's-pay-4',
      state: { name: 'canceled' },
      currency: 'EUR',
      transactions: [
        { type: 'charge', status: 'error', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-4/charges/c1' },
      ],
    };
    expect(map(payment)).toBe(PaymentState.FAILED);
  });

  it('a pending payment with an outstanding redirect (3DS) → REDIRECTED', () => {
    expect(map({ id: 's-pay-5', state: { name: 'pending' }, redirectUrl: 'https://unzer.test/3ds/s-pay-5' })).toBe(
      PaymentState.REDIRECTED,
    );
  });

  it('a succeeded cancellation on a captured payment → REFUNDED; on an authorization → CANCELLED', () => {
    const refunded: UnzerPayment = {
      id: 's-pay-6',
      state: { name: 'completed' },
      currency: 'EUR',
      amount: { total: '10.00', charged: '10.00', canceled: '10.00' },
      transactions: [
        { type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-6/charges/c1' },
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-6/charges/c1/cancels/x1',
        },
      ],
    };
    expect(map(refunded)).toBe(PaymentState.REFUNDED);

    const voided: UnzerPayment = {
      id: 's-pay-7',
      state: { name: 'canceled' },
      currency: 'EUR',
      transactions: [
        { type: 'authorization', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-7/authorize/a1' },
        {
          type: 'cancellation',
          status: 'success',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-7/authorize/a1/cancels/x1',
        },
      ],
    };
    expect(map(voided)).toBe(PaymentState.CANCELLED);
  });

  it('maps the coarse state fallback with no discriminating leg (canceled)', () => {
    expect(map({ id: 's-pay-8', state: { name: 'canceled' } })).toBe(PaymentState.CANCELLED);
  });

  // A chargeback is the shopper's bank reversing settled money, not the merchant refunding it. It records
  // the same CT Transaction as a refund (the money did go back), but it is its OWN lifecycle value, because
  // it is the one settlement that must leave `paymentStatus.state` alone. Folding it into
  // REFUNDED destroyed that distinction before any consumer could see it.
  it('maps chargeback to its own CHARGEBACK state, never to REFUNDED', () => {
    expect(map({ id: 's-pay-9', state: { name: 'chargeback' } })).toBe(PaymentState.CHARGEBACK);
  });

  it('a captured payment is derived from the amount book even without a status-bearing leg', () => {
    expect(
      map({ id: 's-pay-10', state: { name: 'partly' }, currency: 'EUR', amount: { total: '10.00', charged: '4.00' } }),
    ).toBe(PaymentState.CAPTURED);
  });

  it('fails LOUD on a genuinely uninterpretable payment (no state, no legs, no redirect, no outcome)', () => {
    expect(() => unzerPaymentStatus({ id: 's-pay-x' })).toThrow(PspError);
  });
});

/**
 * A CHARGE or AUTHORIZE answers with the TRANSACTION resource, and that resource is shaped differently from
 * the payment a later `GET /v1/payments/{id}` returns: it carries the outcome triple
 * `isSuccess`/`isPending`/`isError` and NO `state`, NO `transactions`. Interpreting it by `state` alone threw
 * `Uninterpretable Unzer payment state: ''` for every synchronous answer with no redirect - a `prepayment`
 * charge answers `201` with `isPending: true` and nothing else the older branches could read, which refused a
 * payment the vendor had accepted. The triple is therefore read when there is no `state` to read.
 */
describe('unzerPaymentStatus - the charge/authorize response, which carries an outcome and no state', () => {
  const map = (payment: UnzerPayment, bookingMode?: 'charge' | 'authorize') =>
    mapProviderStatus({ state: unzerPaymentStatus(payment, bookingMode) });

  it('a synchronously successful CHARGE → CAPTURED', () => {
    expect(map({ id: 's-chg-1', isSuccess: true }, 'charge')).toBe(PaymentState.CAPTURED);
  });

  // A successful authorization holds the money rather than moving it, which is the AUTHORIZED headroom the
  // merchant panel captures against - reading it as CAPTURED would record money that has not moved.
  it('a synchronously successful AUTHORIZE → AUTHORIZED', () => {
    expect(map({ id: 's-aut-1', isSuccess: true }, 'authorize')).toBe(PaymentState.AUTHORIZED);
  });

  // A pending charge is an asked-for capture that has not settled: `prepayment` waits for the shopper's bank
  // transfer, a paylater charge for the vendor's own processing. The settling webhook carries the outcome.
  it('a pending CHARGE with no redirect → CAPTURE_REQUESTED', () => {
    expect(map({ id: 's-chg-2', isPending: true }, 'charge')).toBe(PaymentState.CAPTURE_REQUESTED);
  });

  it('a pending AUTHORIZE with no redirect → AUTHORIZATION_REQUESTED', () => {
    expect(map({ id: 's-aut-2', isPending: true }, 'authorize')).toBe(PaymentState.AUTHORIZATION_REQUESTED);
  });

  // The redirect branch still wins: the shopper has somewhere to go, whatever the triple says.
  it('a pending response carrying a redirect URL → REDIRECTED', () => {
    expect(
      map(
        { id: 's-chg-3', isPending: true, redirectUrl: 'https://sbx-payment.heidelpay.com/v1/redirect/klarna/s-x' },
        'charge',
      ),
    ).toBe(PaymentState.REDIRECTED);
  });

  // A 2xx carrying `errors` is already refused in the client; a triple that reports an error and nothing else
  // is the same verdict reached one layer later.
  it('an errored response → REJECTED', () => {
    expect(map({ id: 's-chg-4', isError: true }, 'charge')).toBe(PaymentState.FAILED);
  });

  // `isSuccess: false` rides on every pending answer, so it states nothing on its own: a response with no
  // TRUE flag and no state is still uninterpretable, and stays loud.
  it('fails LOUD when every outcome flag is false and there is no state', () => {
    expect(() => unzerPaymentStatus({ id: 's-chg-5', isSuccess: false, isPending: false, isError: false })).toThrow(
      PspError,
    );
  });

  // A PAYMENT read keeps its own path: `state` decides, and the triple is not part of that resource.
  it('leaves a payment read with a state on the state path', () => {
    expect(map({ id: 's-pay-9', state: { name: 'completed' }, currency: 'EUR' })).toBe(PaymentState.CAPTURED);
  });
});

/**
 * The event names the OPERATION only (the reliable discriminator the payment resource alone cannot give -
 * a cancellation-of-charge and a cancellation-of-authorization look alike on the payment); the pointed-at
 * leg's OWN outcome decides the success half: `success` settles into the kind's status, `error` flips to a
 * rejected outcome, and a `pending` leg of ANY settlement kind yields that operation's in-flight status -
 * every kind has one, so a pending operation records nothing rather than inheriting the payment's own
 * status. Only a missing leg or an unrecognised outcome defers to the payment-resource interpreter. It must AGREE with the
 * payment-resource interpreter for a settled capture, so a payment reconciled by webhook and by return
 * produces the same `PaymentState`.
 */
describe('unzerWebhookStatus - settlement kind + leg outcome → internal status', () => {
  const payment: UnzerPayment = { id: 's-pay-1', state: { name: 'completed' }, paymentReference: 'ref' };

  it('maps each settlement kind to its settled status when the pointed-at leg SUCCEEDED', () => {
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.captured', payment, { type: 'charge', status: 'success' }),
      }),
    ).toBe(PaymentState.CAPTURED);
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.pending_capture', payment, { type: 'authorization', status: 'success' }),
      }),
    ).toBe(PaymentState.AUTHORIZED);
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.cancelled', payment, { type: 'cancellation', status: 'success' }),
      }),
    ).toBe(PaymentState.CANCELLED);
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.refunded', payment, { type: 'cancellation', status: 'success' }),
      }),
    ).toBe(PaymentState.REFUNDED);
  });

  it('a PENDING charge leg under a charge event → CAPTURE_REQUESTED, never a settled CAPTURED', () => {
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.captured', payment, { type: 'charge', status: 'pending' }),
      }),
    ).toBe(PaymentState.CAPTURE_REQUESTED);
  });

  it('a PENDING authorization leg under an authorize event → AUTHORIZATION_REQUESTED', () => {
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.pending_capture', payment, { type: 'authorization', status: 'pending' }),
      }),
    ).toBe(PaymentState.AUTHORIZATION_REQUESTED);
  });

  it('a PENDING cancellation leg under a refund event is REFUND_REQUESTED, never the payment-level status', () => {
    // The OPERATION is what the event asks about: the payment is still CAPTURED, but this refund has settled
    // nothing. Answering CAPTURED here would record a second charge under the cancellation's own id.
    const captured: UnzerPayment = {
      id: 's-pay-1',
      state: { name: 'completed' },
      currency: 'EUR',
      amount: { total: '10.00', charged: '10.00' },
      transactions: [
        { type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/c1' },
        {
          type: 'cancellation',
          status: 'pending',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/c1/cancels/x1',
        },
      ],
    };
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.refunded', captured, captured.transactions![1]),
      }),
    ).toBe(PaymentState.REFUND_REQUESTED);
  });

  it('a MISSING pointed-at leg defers to the payment resource for every kind', () => {
    // The completed no-leg payment reads CAPTURED regardless of the kind the event named …
    expect(mapProviderStatus({ state: unzerWebhookStatus('payment.captured', payment, undefined) })).toBe(
      PaymentState.CAPTURED,
    );
    expect(mapProviderStatus({ state: unzerWebhookStatus('payment.refunded', payment, undefined) })).toBe(
      PaymentState.CAPTURED,
    );
    // … while a canceled no-leg payment reads CANCELLED - the resource, never the event, decides.
    const canceled: UnzerPayment = { id: 's-pay-2', state: { name: 'canceled' }, paymentReference: 'ref' };
    expect(mapProviderStatus({ state: unzerWebhookStatus('payment.cancelled', canceled, undefined) })).toBe(
      PaymentState.CANCELLED,
    );
  });

  it('an ERRORED authorization leg under payment.pending_capture → FAILED (a declined authorization)', () => {
    // `payment.pending_capture` IS the authorization operation: the provider maps the vendor's `authorize`
    // event to it (`EVENT_KIND`) and only an authorization leg may settle it (`KIND_LEG_PREDICATE`). So
    // `KIND_TRANSACTION_TYPE['payment.pending_capture']` is 'Authorization' (handle-webhook.ts) and this
    // refusal is recorded as an `Authorization:Failure`, not as a declined capture.
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.pending_capture', payment, { type: 'authorization', status: 'error' }),
      }),
    ).toBe(PaymentState.FAILED);
  });

  it('a PENDING cancellation leg under a cancel event is CANCEL_REQUESTED, never the payment-level status', () => {
    // Same rule on the void side: the payment is still AUTHORIZED, but answering that would record an
    // Authorization:Success for money the vendor is in the middle of releasing.
    const authorized: UnzerPayment = {
      id: 's-pay-4',
      state: { name: 'pending' },
      currency: 'EUR',
      transactions: [
        { type: 'authorization', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-4/authorize/a1' },
        {
          type: 'cancellation',
          status: 'pending',
          url: 'https://sbx-api.unzer.com/v1/payments/s-pay-4/authorize/a1/cancels/x1',
        },
      ],
    };
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.cancelled', authorized, authorized.transactions![1]),
      }),
    ).toBe(PaymentState.CANCEL_REQUESTED);
  });

  it('an errored leg turns a settlement into FAILED, for a charge and for any other kind', () => {
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.captured', payment, { type: 'charge', status: 'error' }),
      }),
    ).toBe(PaymentState.FAILED);
    expect(
      mapProviderStatus({
        state: unzerWebhookStatus('payment.refunded', payment, { type: 'cancellation', status: 'error' }),
      }),
    ).toBe(PaymentState.FAILED);
  });

  it('agrees with unzerPaymentStatus on a settled capture (webhook vs return produce the same state)', () => {
    const captured: UnzerPayment = {
      id: 's-pay-1',
      state: { name: 'completed' },
      currency: 'EUR',
      transactions: [
        { type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/c1' },
      ],
    };
    const viaWebhook = mapProviderStatus({
      state: unzerWebhookStatus('payment.captured', captured, captured.transactions![0]),
    });
    const viaReturn = mapProviderStatus({ state: unzerPaymentStatus(captured) });
    expect(viaWebhook).toBe(viaReturn);
    expect(viaReturn).toBe(PaymentState.CAPTURED);
  });
});

/**
 * The operation-level analogue of {@link unzerPaymentStatus}: one transaction leg's kind + own outcome →
 * the internal operation status the reconciliation reads (`toProviderOperations` feeds it, `legResolution`
 * maps it through `STATUS_TABLE`). A leg no rule interprets does NOT throw here - it returns a value the
 * table cannot map, so the fail-loud lands at `mapProviderStatus`, inside the reconciliation's per-leg fence.
 */
describe('unzerOperationStatus - one Unzer leg → internal operation status', () => {
  const map = (leg: UnzerTransaction) => mapProviderStatus({ state: unzerOperationStatus(leg) });

  it('maps a charge leg by its own outcome (success/pending/error)', () => {
    expect(map({ type: 'charge', status: 'success' })).toBe(PaymentState.CAPTURED);
    expect(map({ type: 'charge', status: 'pending' })).toBe(PaymentState.CAPTURE_REQUESTED);
    expect(map({ type: 'charge', status: 'error' })).toBe(PaymentState.FAILED);
  });

  it('maps an authorization leg by its own outcome (success/pending/error)', () => {
    expect(map({ type: 'authorization', status: 'success' })).toBe(PaymentState.AUTHORIZED);
    expect(map({ type: 'authorization', status: 'pending' })).toBe(PaymentState.AUTHORIZATION_REQUESTED);
    expect(map({ type: 'authorization', status: 'error' })).toBe(PaymentState.FAILED);
  });

  it('reads a succeeded cancellation as a refund when its URL reverses a charge, a void when it reverses an authorization', () => {
    expect(
      map({
        type: 'cancellation',
        status: 'success',
        url: 'https://sbx-api.unzer.com/v1/payments/p/charges/c1/cancels/x1',
      }),
    ).toBe(PaymentState.REFUNDED);
    expect(
      map({
        type: 'cancellation',
        status: 'success',
        url: 'https://sbx-api.unzer.com/v1/payments/p/authorize/a1/cancels/x1',
      }),
    ).toBe(PaymentState.CANCELLED);
  });

  it('defaults an indeterminable succeeded cancellation to REFUNDED, the fail-closed reading', () => {
    expect(map({ type: 'cancellation', status: 'success' })).toBe(PaymentState.REFUNDED);
  });

  it('agrees with the payment interpreter: a charge-success leg and a captured payment both resolve to CAPTURED', () => {
    const captured: UnzerPayment = {
      id: 'p',
      state: { name: 'completed' },
      currency: 'EUR',
      transactions: [{ type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/p/charges/c1' }],
    };
    const viaLeg = mapProviderStatus({ state: unzerOperationStatus(captured.transactions![0]) });
    const viaPayment = mapProviderStatus({ state: unzerPaymentStatus(captured) });
    expect(viaLeg).toBe(viaPayment);
    expect(viaLeg).toBe(PaymentState.CAPTURED);
  });

  // The vocabulary a LIVE payment read really answers with. `GET /v1/payments/{id}` types a refund leg
  // `cancel-charge`, not the generic `cancellation` the interpretation was authored against - so every
  // refund leg used to fall through to the diagnostic and throw at `mapProviderStatus`, taking the order
  // panel's whole operation list with it.
  it.each([
    ['cancel-charge', PaymentState.REFUNDED],
    ['cancel-authorize', PaymentState.CANCELLED],
  ])('reads the vendor transaction-type name %s', (type, expected) => {
    expect(map({ type, status: 'success', url: 'https://api.unzer.com/v1/payments/p/charges/c1/cancels/x' })).toBe(
      expected,
    );
  });

  // `authorize` and `authorization` are the same leg under the vendor's two vocabularies.
  it('reads both spellings of an authorization leg alike', () => {
    const url = 'https://api.unzer.com/v1/payments/p/authorize/a1';
    expect(map({ type: 'authorize', status: 'success', url })).toBe(
      map({ type: 'authorization', status: 'success', url }),
    );
  });

  // The connector subscribes the `chargeback` event and settles this leg, so introspection must be able
  // to read it too - throwing here would blow up the order panel on the very leg the webhook reconciles.
  it('reads a settled chargeback leg as CHARGEBACK', () => {
    expect(map({ type: 'chargeback', status: 'success' })).toBe(PaymentState.CHARGEBACK);
  });

  it('fails LOUD (via mapProviderStatus, never a silent default) on a leg kind/outcome it does not interpret', () => {
    expect(() => map({ type: 'charge', status: 'weird' })).toThrow(PspError);
    expect(() => map({ type: 'cancellation', status: 'error' })).toThrow(PspError);
    expect(() => map({ type: 'chargeback', status: 'pending' })).toThrow(PspError);
  });
});
