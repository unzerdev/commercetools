/**
 * The `PaymentState` → commercetools `paymentStatus.state` table.
 *
 * The Merchant Center's Payment page renders "Payment state" from `paymentStatus.state`, a reference to a
 * `State` of type `PaymentState`. The connector holds no such vocabulary of its own, so the states it
 * registers are a STATIC mapping of the 16-value PSP-agnostic lifecycle onto what a merchant reads:
 * unpaid, in progress, paid, given back, voided, declined.
 *
 * The table is exhaustive over `PaymentState` by TYPE, so a new lifecycle value cannot compile without a
 * decision here. `CHARGEBACK` is the one value that maps to NOTHING, deliberately: a chargeback is not a
 * payment state a merchant acts on through this field, and overwriting the state a payment reached would
 * lose that history.
 *
 * The field reports the PAYMENT, not the last operation, which is why the decision also reads the payment's
 * transactions: `FAILED`, `CAPTURE_REQUESTED`, `REFUND_REQUESTED` and `CANCEL_REQUESTED` are outcomes of one
 * operation and may only name the payment's state while no leg of it has settled.
 */
import { describe, expect, it, test } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { paymentStateDeclarations, paymentStatusState } from '../src/domain';

/** A payment with nothing settled — the operation whose outcome is being mapped IS the payment. */
const nothingSettled: { type: string; state: string }[] = [];

/** A fully captured payment: `Authorization:Success` + `Charge:Success` for the planned amount. */
const capturedInFull = [
  { type: 'Authorization', state: 'Success' },
  { type: 'Charge', state: 'Success' },
];

/** A payment whose only leg is a declined authorization — money the vendor never held. */
const authorizationRefused = [{ type: 'Authorization', state: 'Failure' }];

/** A payment holding a settled authorization and nothing captured against it yet. */
const authorizedOnly = [{ type: 'Authorization', state: 'Success' }];

/** A payment charged and then given back in full. */
const refundedInFull = [
  { type: 'Authorization', state: 'Success' },
  { type: 'Charge', state: 'Success' },
  { type: 'Refund', state: 'Success' },
];

/** A payment whose authorization was voided before anything was captured. */
const authorizationVoided = [
  { type: 'Authorization', state: 'Success' },
  { type: 'CancelAuthorization', state: 'Success' },
];

describe('paymentStatusState — the static PaymentState → payment-state mapping', () => {
  test.each([
    [PaymentState.INITIAL, 'new'],
    [PaymentState.REDIRECTED, 'new'],
    [PaymentState.AUTHORIZED, 'processing'],
    [PaymentState.AUTHORIZATION_REQUESTED, 'processing'],
    [PaymentState.CAPTURE_REQUESTED, 'processing'],
    [PaymentState.REFUND_REQUESTED, 'processing'],
    [PaymentState.CANCEL_REQUESTED, 'processing'],
    [PaymentState.IN_REVIEW, 'processing'],
    [PaymentState.PARTIALLY_CAPTURED, 'processing'],
    [PaymentState.CAPTURED, 'completed'],
    [PaymentState.REFUNDED, 'refunded'],
    [PaymentState.PARTIALLY_REFUNDED, 'partially-refunded'],
    [PaymentState.CANCELLED, 'cancelled'],
    [PaymentState.PARTIALLY_CANCELLED, 'partially-cancelled'],
    [PaymentState.FAILED, 'failed'],
  ])('%s → %s', (state, expected) => {
    expect(paymentStatusState(state, nothingSettled)).toBe(expected);
  });

  // Only a FULL capture is money the merchant may treat as paid. A partial one still has a balance
  // authorized, so it reads as in progress and the exact figures stay in the transactions.
  it('separates a full capture from a partial one', () => {
    expect(paymentStatusState(PaymentState.CAPTURED, nothingSettled)).toBe('completed');
    expect(paymentStatusState(PaymentState.PARTIALLY_CAPTURED, nothingSettled)).toBe('processing');
  });

  // A chargeback leaves the state it found. It is a dispute over money already recorded as paid or given
  // back, and none of the connector's states says that — writing one would erase what the payment had reached.
  it('maps CHARGEBACK to no state at all, so the payment keeps the state it reached', () => {
    expect(paymentStatusState(PaymentState.CHARGEBACK, capturedInFull)).toBeUndefined();
  });

  // The property, not an example of it: every lifecycle value is decided, and every decision that names a
  // state names one the connector actually registers.
  it('decides every PaymentState, and never names a state post-deploy does not create', () => {
    Object.values(PaymentState).forEach((state) => {
      [nothingSettled, capturedInFull].forEach((transactions) => {
        const mapped = paymentStatusState(state, transactions);
        if (mapped !== undefined) {
          expect(paymentStateDeclarations.map((declaration) => declaration.key)).toContain(mapped);
        }
      });
    });
  });
});

/**
 * The field reports the payment's own position, never the verdict on its last operation. A vendor that
 * declines a refund of a payment it charged €15.00 for has not undone the charge: the transaction list still
 * shows `Charge:Success`, so `Payment state` must still read `Completed` — and the vendor's own reason for
 * the refusal reaches the operator through `interfaceCode` / `interfaceText`, which are written regardless.
 */
describe('a state that describes the OPERATION, not the payment', () => {
  /** The four lifecycle values that report ONE operation's outcome, and so may never restate a settled payment. */
  const operationStates: [PaymentState][] = [
    [PaymentState.FAILED],
    [PaymentState.CAPTURE_REQUESTED],
    [PaymentState.REFUND_REQUESTED],
    [PaymentState.CANCEL_REQUESTED],
  ];

  test.each(operationStates)('%s names no state once a leg of the payment has settled', (state) => {
    expect(paymentStatusState(state, capturedInFull)).toBeUndefined();
  });

  // The boundary is a SETTLED leg, not a leg whose money moved — the one input that separates this guard from
  // the pre-settlement one below. An `Authorization:Success` is money the vendor holds and will hand over on
  // request, so a capture it refuses restates nothing about the payment: the authorization is still live and
  // its full amount still capturable. It is also the ordinary card shape, since `card` authorizes by default
  // (`METHOD_TRANSACTION_SUPPORT`, `psp/supported-methods.ts`), so reading `failed` here would mark a payable
  // payment declined on the first refused capture — and permanently.
  test.each(operationStates)('%s names no state on a payment holding a settled authorization', (state) => {
    expect(paymentStatusState(state, authorizedOnly)).toBeUndefined();
  });

  // The same values still name the payment's state while nothing has settled: there the operation IS the
  // payment, so a declined authorization — answered synchronously or delivered later as a refused
  // settlement — must read `Failed` rather than stay `New`.
  it('a refusal on a payment with nothing settled reads failed', () => {
    expect(paymentStatusState(PaymentState.FAILED, nothingSettled)).toBe('failed');
    expect(paymentStatusState(PaymentState.FAILED, authorizationRefused)).toBe('failed');
  });

  // A settled money movement of the payment is the payment's own position whatever reached it, so a
  // modification that succeeds still summarises the payment.
  it('a settled money movement still names the payment state on a payment that already has legs', () => {
    expect(paymentStatusState(PaymentState.REFUNDED, capturedInFull)).toBe('refunded');
    expect(paymentStatusState(PaymentState.CANCELLED, authorizedOnly)).toBe('cancelled');
    expect(paymentStatusState(PaymentState.CAPTURED, authorizedOnly)).toBe('completed');
  });
});

/**
 * The field reports the payment's own POSITION, so a lifecycle state that reports money not yet received
 * cannot restate a payment whose money has already moved. Reordered delivery is why this is a guard rather
 * than an assumption: Unzer subscribes the connector to its account-wide event stream (`event: 'all'`) with no
 * ordering guarantee, so on a redirect or 3-D Secure charge — where `createPayment` records
 * `Authorization:Pending`, not `Success`, and step 11's duplicate gate therefore lets the authorize event
 * through — a `payment.pending_capture` delivery can arrive AFTER `payment.captured`. It maps to `AUTHORIZED`
 * (`psp/unzer-status.ts` → `psp/status-map.ts`), and writing its `processing` would report a fully captured
 * payment as still in flight, permanently: no later event on a captured payment restates the field.
 */
describe('a state that reports money the payment has already moved past', () => {
  test.each([
    [PaymentState.INITIAL],
    [PaymentState.REDIRECTED],
    [PaymentState.AUTHORIZED],
    [PaymentState.AUTHORIZATION_REQUESTED],
    [PaymentState.IN_REVIEW],
  ])('%s names no state once money of the payment has moved', (state) => {
    expect(paymentStatusState(state, capturedInFull)).toBeUndefined();
  });

  // The guard reads a settled leg OTHER than the authorization, so it holds for every position a payment
  // reaches past its authorization — not only for a capture.
  it('holds for a refunded and for a voided payment too', () => {
    expect(paymentStatusState(PaymentState.AUTHORIZED, refundedInFull)).toBeUndefined();
    expect(paymentStatusState(PaymentState.AUTHORIZED, authorizationVoided)).toBeUndefined();
  });

  // An `Authorization:Success` is money RESERVED, which is exactly what these positions report — so a payment
  // holding only that is still theirs to describe.
  it('still names the payment state while only the authorization has settled', () => {
    expect(paymentStatusState(PaymentState.AUTHORIZED, authorizedOnly)).toBe('processing');
    expect(paymentStatusState(PaymentState.IN_REVIEW, authorizedOnly)).toBe('processing');
  });

  // `PARTIALLY_CAPTURED` is the one `processing` position a payment with a settled charge legitimately
  // reaches: a partial capture IS a settled charge with a balance still authorized.
  it('leaves a partial capture free to restate a payment whose charge has settled', () => {
    expect(paymentStatusState(PaymentState.PARTIALLY_CAPTURED, capturedInFull)).toBe('processing');
  });
});

describe('paymentStateDeclarations — what post-deploy registers', () => {
  it('declares exactly the states the table can name, keyed by bare name', () => {
    expect(paymentStateDeclarations.map((declaration) => declaration.key)).toEqual([
      'new',
      'processing',
      'completed',
      'refunded',
      // A partial reversal is its own fact: reported as `refunded`, a payment that gave back 2 of 12
      // reads as a settled and closed order, and the money still held disappears from the summary.
      'partially-refunded',
      'cancelled',
      'partially-cancelled',
      'failed',
    ]);
  });

  it('every declaration is a PaymentState with a name to render', () => {
    paymentStateDeclarations.forEach((declaration) => {
      expect(declaration.type).toBe('PaymentState');
      expect(declaration.name.en.length).toBeGreaterThan(0);
    });
  });

  // `new` is where a payment enters the lifecycle, and commercetools wants exactly one initial state.
  it('names `new` as the initial state, and only it', () => {
    expect(paymentStateDeclarations.filter((declaration) => declaration.initial)).toHaveLength(1);
    expect(paymentStateDeclarations.find((declaration) => declaration.initial)?.key).toBe('new');
  });

  /**
   * No declaration carries `transitions`. An unset `transitions` means commercetools permits EVERY
   * transition, and the connector's lifecycle is not linear: a payment reaches `refunded` from
   * `completed`, `failed` from `processing`, `cancelled` from either. A declared graph would let the
   * connector's own state machine refuse the connector's own write.
   */
  it('declares no transition graph, so no write of ours can be refused by our own states', () => {
    paymentStateDeclarations.forEach((declaration) => {
      expect(declaration).not.toHaveProperty('transitions');
    });
  });
});
