import { describe, expect, it } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { openedOperationEffect, resolveStateEffect, type StateEffect } from '../src/domain';

// The single source of truth for the expected PSP-agnostic to CT Transaction mapping (the table below
// carries both hops). Every one of the 16 PaymentState values MUST have an explicit entry here — a
// deliberate no-op or a transaction. Only a value ABSENT from the machine throws.
const EXPECTED: Record<PaymentState, StateEffect> = {
  // Deliberate no-transition states (F3): the operation was submitted or the shopper
  // is mid-flow; settlement lands later via a webhook. A mapped no-op is NOT a failure.
  INITIAL: { kind: 'no-op' },
  REDIRECTED: { kind: 'no-op' },
  AUTHORIZATION_REQUESTED: { kind: 'no-op' },
  CAPTURE_REQUESTED: { kind: 'no-op' },
  REFUND_REQUESTED: { kind: 'no-op' },
  CANCEL_REQUESTED: { kind: 'no-op' },
  // Settled lifecycle transitions.
  AUTHORIZED: { kind: 'transaction', transaction: { type: 'Authorization', state: 'Success' } },
  CAPTURED: { kind: 'transaction', transaction: { type: 'Charge', state: 'Success' } },
  REFUNDED: { kind: 'transaction', transaction: { type: 'Refund', state: 'Success' } },
  // A chargeback moves money back exactly as a refund does, so the CT Transaction is the same one: the
  // Payment's figures must show the money gone whoever reversed it. The distinction lives where it changes
  // an answer — `paymentStatus.state`, which a chargeback leaves alone.
  CHARGEBACK: { kind: 'transaction', transaction: { type: 'Refund', state: 'Success' } },
  CANCELLED: { kind: 'transaction', transaction: { type: 'CancelAuthorization', state: 'Success' } },
  FAILED: { kind: 'transaction', transaction: { type: 'Authorization', state: 'Failure' } },
  // Manual/fraud review: Authorization:Pending plus the PSP-agnostic payment-review custom field.
  IN_REVIEW: { kind: 'transaction', transaction: { type: 'Authorization', state: 'Pending' }, reviewField: true },
  // Partial lifecycle transitions record a transaction for the partial amount; the balance stays.
  PARTIALLY_CAPTURED: { kind: 'transaction', transaction: { type: 'Charge', state: 'Success' } },
  PARTIALLY_REFUNDED: { kind: 'transaction', transaction: { type: 'Refund', state: 'Success' } },
  PARTIALLY_CANCELLED: { kind: 'transaction', transaction: { type: 'CancelAuthorization', state: 'Success' } },
};

describe('PSP-agnostic state machine', () => {
  it('has an explicit entry for every one of the 16 PaymentState values', () => {
    const values = Object.values(PaymentState);
    expect(values).toHaveLength(16);
    for (const value of values) {
      // Never throws for an in-enum value — each is an explicit no-op or transaction.
      expect(() => resolveStateEffect(value)).not.toThrow();
    }
  });

  it.each(Object.values(PaymentState))('maps %s to its intended CT effect', (value) => {
    expect(resolveStateEffect(value)).toEqual(EXPECTED[value]);
  });

  it('maps IN_REVIEW to Authorization:Pending with the review custom field', () => {
    const effect = resolveStateEffect(PaymentState.IN_REVIEW);
    expect(effect).toEqual({
      kind: 'transaction',
      transaction: { type: 'Authorization', state: 'Pending' },
      reviewField: true,
    });
  });

  it('enumerates the deliberate no-transition states as no-ops, not throws', () => {
    for (const value of [
      'INITIAL',
      'REDIRECTED',
      'AUTHORIZATION_REQUESTED',
      'CAPTURE_REQUESTED',
      'REFUND_REQUESTED',
    ] as const) {
      expect(resolveStateEffect(PaymentState[value])).toEqual({ kind: 'no-op' });
    }
  });

  it('throws loudly for a PSP-agnostic value absent from the table (fails loud, never silent)', () => {
    expect(() => resolveStateEffect('BOGUS_STATE' as PaymentState)).toThrow(/BOGUS_STATE/);
  });
});

/**
 * The create leg's overlay on the table. A pay answer that only says the operation is OPEN (a redirect ahead,
 * a transfer awaited) records a `Pending` leg of the kind that was booked, so a host verifying the payment right
 * after the call finds the operation on record; the table's own no-op stays right for the webhook, which must
 * not settle what the vendor has not.
 */
describe('openedOperationEffect: the create leg records the opened operation', () => {
  const OPEN = [
    PaymentState.INITIAL,
    PaymentState.REDIRECTED,
    PaymentState.AUTHORIZATION_REQUESTED,
    PaymentState.CAPTURE_REQUESTED,
  ] as const;

  it.each(OPEN)('%s under a charge booking is a Charge:Pending leg', (state) => {
    expect(openedOperationEffect(state, 'charge')).toEqual({
      kind: 'transaction',
      transaction: { type: 'Charge', state: 'Pending' },
    });
  });

  it.each(OPEN)('%s under an authorize booking is an Authorization:Pending leg', (state) => {
    expect(openedOperationEffect(state, 'authorize')).toEqual({
      kind: 'transaction',
      transaction: { type: 'Authorization', state: 'Pending' },
    });
  });

  it('leaves a settled state exactly as the table has it, the review field included', () => {
    for (const state of [
      PaymentState.CAPTURED,
      PaymentState.AUTHORIZED,
      PaymentState.FAILED,
      PaymentState.IN_REVIEW,
    ] as const) {
      expect(openedOperationEffect(state, 'charge')).toEqual(resolveStateEffect(state));
      expect(openedOperationEffect(state, 'authorize')).toEqual(resolveStateEffect(state));
    }
  });

  // A pay call never answers with a refund or a cancel in flight; those markers keep the table's no-op so that
  // a caller misusing the overlay writes nothing rather than a leg of the wrong kind.
  it('leaves REFUND_REQUESTED and CANCEL_REQUESTED as no-ops', () => {
    expect(openedOperationEffect(PaymentState.REFUND_REQUESTED, 'charge')).toEqual({ kind: 'no-op' });
    expect(openedOperationEffect(PaymentState.CANCEL_REQUESTED, 'authorize')).toEqual({ kind: 'no-op' });
  });
});
