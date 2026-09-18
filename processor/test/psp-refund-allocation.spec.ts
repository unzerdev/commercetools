/**
 * Refund allocation across charges — the arithmetic that decides how many vendor calls a refund is and
 * what each one carries.
 *
 * Unzer cancels a refund AGAINST A CHARGE, so a payment captured in several charges cannot be refunded
 * in one call beyond what any single charge holds. The scenarios here are the reference PHP
 * integration's own (`OrderManagementServiceTest::testRefundingMultipleChargeItems` and
 * `::testRefundSkipsAlreadyCanceledCharges`), so the two connectors split money the same way.
 */
import { describe, expect, it } from '@jest/globals';
import type { UnzerPayment } from '../src/providers/psp/client';
import { allocateRefund, chargeRemainders } from '../src/providers/psp/modifications/refund-allocation';
import { operationIdentity } from '../src/providers/psp/status';

const base = 'https://api.unzer.com/v1/payments/s-pay-1';

/** A settled charge leg the vendor reports, with its decimal wire amount. */
const charge = (id: string, amount: string) => ({
  type: 'charge',
  status: 'success',
  url: `${base}/charges/${id}`,
  amount,
});

/** A settled cancellation ON a charge — a refund, which is what reduces that charge's remainder. */
const refundLeg = (chargeId: string, cancelId: string, amount: string) => ({
  type: 'cancel-charge',
  status: 'success',
  url: `${base}/charges/${chargeId}/cancels/${cancelId}`,
  amount,
});

const payment = (transactions: unknown[]): UnzerPayment =>
  ({ id: 's-pay-1', currency: 'EUR', transactions }) as UnzerPayment;

/** A cancellation the vendor accepted but has not settled — money already on its way back. */
const pendingRefundLeg = (chargeId: string, cancelId: string, amount: string) => ({
  ...refundLeg(chargeId, cancelId, amount),
  status: 'pending',
});

/** A cancellation the vendor REFUSED — it gave nothing back, so it spends no headroom. */
const refusedRefundLeg = (chargeId: string, cancelId: string, amount: string) => ({
  ...refundLeg(chargeId, cancelId, amount),
  status: 'error',
});

/**
 * Every amount is lifted by an INTEGER parse of the decimal wire string, never by float arithmetic. The
 * amounts below are the ones a float gets wrong: `0.29 * 100` is 28.999999999999996 and `1.15 * 100` is
 * 114.99999999999999, so a rounded float allocation can hand a charge one cent more than it holds - and
 * the vendor then refuses the whole refund rather than the cent.
 */
describe('the wire amount is lifted by integer parse, not float arithmetic', () => {
  it('lifts the amounts a float would round wrong', () => {
    expect(chargeRemainders(payment([charge('c1', '0.29'), charge('c2', '1.15')]), 2)).toEqual([
      { chargeId: 'c1', refundableCents: 29 },
      { chargeId: 'c2', refundableCents: 115 },
    ]);
  });

  it('keeps a charge and its own cancellation exactly in step, leaving no phantom cent', () => {
    expect(chargeRemainders(payment([charge('c1', '8.29'), refundLeg('c1', 'r1', '8.29')]), 2)).toEqual([]);
  });

  it('allocates the last cent of a charge without overdrawing it', () => {
    expect(allocateRefund(payment([charge('c1', '0.29')]), 29, 2)).toEqual({
      slices: [{ chargeId: 'c1', amountCents: 29 }],
      shortfallCents: 0,
    });
  });
});

describe('chargeRemainders', () => {
  it('subtracts each charge own cancellations, attributed by the leg url', () => {
    const remainders = chargeRemainders(
      payment([charge('c1', '50.00'), charge('c2', '50.00'), refundLeg('c1', 'x1', '20.00')]),
      2,
    );

    expect(remainders).toEqual([
      { chargeId: 'c1', refundableCents: 3000 },
      { chargeId: 'c2', refundableCents: 5000 },
    ]);
  });

  // A void reverses an authorization, not a charge, and must not be counted against one.
  it('ignores a cancellation that names no charge parent', () => {
    const remainders = chargeRemainders(
      payment([
        charge('c1', '50.00'),
        {
          type: 'cancel-authorize',
          status: 'success',
          url: `${base}/authorize/a1/cancels/v1`,
          amount: '10.00',
        },
      ]),
      2,
    );

    expect(remainders).toEqual([{ chargeId: 'c1', refundableCents: 5000 }]);
  });

  it('drops charges that are exhausted, and legs the vendor has not settled', () => {
    const remainders = chargeRemainders(
      payment([
        charge('c1', '50.00'),
        refundLeg('c1', 'x1', '50.00'),
        { type: 'charge', status: 'pending', url: `${base}/charges/c2`, amount: '50.00' },
        charge('c3', '10.00'),
      ]),
      2,
    );

    expect(remainders).toEqual([{ chargeId: 'c3', refundableCents: 1000 }]);
  });
});

describe('allocateRefund', () => {
  // The case that prompted this: 90 across two charges of 50 is 50 + 40, not one call for 90.
  it('spreads across charges, oldest first, taking what each can carry', () => {
    const { slices, shortfallCents } = allocateRefund(payment([charge('c1', '50.00'), charge('c2', '50.00')]), 9000, 2);

    expect(slices).toEqual([
      { chargeId: 'c1', amountCents: 5000 },
      { chargeId: 'c2', amountCents: 4000 },
    ]);
    expect(shortfallCents).toBe(0);
  });

  // The reference's own multi-charge scenario: five charges of 10, already cancelled 0/5/5/3/0, for 30.
  it('matches the reference allocation over five partly cancelled charges', () => {
    const { slices, shortfallCents } = allocateRefund(
      payment([
        charge('c1', '10.00'),
        charge('c2', '10.00'),
        charge('c3', '10.00'),
        charge('c4', '10.00'),
        charge('c5', '10.00'),
        refundLeg('c2', 'x2', '5.00'),
        refundLeg('c3', 'x3', '5.00'),
        refundLeg('c4', 'x4', '3.00'),
      ]),
      3000,
      2,
    );

    expect(slices).toEqual([
      { chargeId: 'c1', amountCents: 1000 },
      { chargeId: 'c2', amountCents: 500 },
      { chargeId: 'c3', amountCents: 500 },
      { chargeId: 'c4', amountCents: 700 },
      { chargeId: 'c5', amountCents: 300 },
    ]);
    expect(shortfallCents).toBe(0);
  });

  it('skips a fully cancelled charge and draws the whole amount from the next', () => {
    const { slices } = allocateRefund(
      payment([charge('c1', '50.00'), charge('c2', '50.00'), refundLeg('c1', 'x1', '50.00')]),
      3000,
      2,
    );

    expect(slices).toEqual([{ chargeId: 'c2', amountCents: 3000 }]);
  });

  it('stops at the first charge when the whole amount fits in it', () => {
    const { slices } = allocateRefund(payment([charge('c1', '100.00'), charge('c2', '10.00')]), 3000, 2);

    expect(slices).toEqual([{ chargeId: 'c1', amountCents: 3000 }]);
  });

  // The reference loop simply ends with the remainder unspent and says nothing. Reporting it is what
  // lets the caller refuse the refund instead of silently under-delivering.
  it('reports the shortfall when the charges together hold less than was asked', () => {
    const { slices, shortfallCents } = allocateRefund(payment([charge('c1', '50.00'), charge('c2', '20.00')]), 9000, 2);

    expect(slices).toEqual([
      { chargeId: 'c1', amountCents: 5000 },
      { chargeId: 'c2', amountCents: 2000 },
    ]);
    expect(shortfallCents).toBe(2000);
  });

  it('allocates nothing when the payment carries no settled charge', () => {
    expect(allocateRefund(payment([]), 5000, 2)).toEqual({ slices: [], shortfallCents: 5000 });
  });

  // Minor units end to end: a currency with no minor digits must not pick up two from a decimal read.
  it('works in the currency own exponent', () => {
    const { slices } = allocateRefund(
      payment([{ type: 'charge', status: 'success', url: `${base}/charges/c1`, amount: '1500' }]),
      50000,
      0,
    );

    expect(slices).toEqual([{ chargeId: 'c1', amountCents: 1500 }]);
  });
});

/**
 * Unzer numbers a cancellation WITHIN its parent charge, so refunding a payment captured in two charges
 * produces two operations whose trailing url segment is the same `s-cnl-1`. Keyed on that segment alone
 * the second refund collides with the first — one id shown twice in the panel, a settling write that
 * re-keys a leg that already exists, and a second webhook swallowed as a redelivery.
 */
describe('operationIdentity', () => {
  it('scopes a cancellation to the charge it came off', () => {
    expect(operationIdentity(`${base}/charges/c1/cancels/s-cnl-1`)).toBe('c1.s-cnl-1');
    expect(operationIdentity(`${base}/charges/c2/cancels/s-cnl-1`)).toBe('c2.s-cnl-1');
  });

  it('keeps a charge, an authorization and a void as their own bare id', () => {
    expect(operationIdentity(`${base}/charges/c1`)).toBe('c1');
    expect(operationIdentity(`${base}/authorize/a1`)).toBe('a1');
    // A void has no charge parent, so there is nothing to scope it to.
    expect(operationIdentity(`${base}/authorize/a1/cancels/v1`)).toBe('v1');
  });

  // The composite reaches a commercetools Custom Object key (`paymentId~kind~operationId`), whose
  // charset admits only `[-_~.A-Za-z0-9]` — a `:` or `/` joiner would be rejected by the write.
  it('joins with a character a commercetools custom-object key admits', () => {
    expect(operationIdentity(`${base}/charges/c1/cancels/s-cnl-1`)).toMatch(/^[-_~.A-Za-z0-9]+$/);
  });

  it('is empty when the url names no resource', () => {
    expect(operationIdentity(undefined)).toBe('');
    expect(operationIdentity('https://api.unzer.com')).toBe('');
  });
});

describe('refunds still in flight', () => {
  // The vendor accepts a refund before it settles. Counting only settled cancellations leaves the charge
  // looking full, so the next refund is allocated onto money that is already on its way back — and the
  // vendor refuses the whole call. This is the same rule the commercetools side applies (COMMITTED).
  it('counts a PENDING cancellation against its charge, the same as a settled one', () => {
    const remainders = chargeRemainders(
      payment([charge('c1', '50.00'), charge('c2', '50.00'), pendingRefundLeg('c1', 'x1', '50.00')]),
      2,
    );

    expect(remainders).toEqual([{ chargeId: 'c2', refundableCents: 5000 }]);
  });

  it('does NOT count a refused cancellation — nothing was given back', () => {
    const remainders = chargeRemainders(payment([charge('c1', '50.00'), refusedRefundLeg('c1', 'x1', '50.00')]), 2);

    expect(remainders).toEqual([{ chargeId: 'c1', refundableCents: 5000 }]);
  });

  // The whole point of the rule above, stated as the allocation it protects: with 50 already in flight on
  // c1, a further refund of 40 must come off c2 and never be handed back to c1.
  it('allocates past a charge whose remainder is held by an in-flight refund', () => {
    const { slices, shortfallCents } = allocateRefund(
      payment([charge('c1', '50.00'), charge('c2', '50.00'), pendingRefundLeg('c1', 'x1', '50.00')]),
      4000,
      2,
    );

    expect(slices).toEqual([{ chargeId: 'c2', amountCents: 4000 }]);
    expect(shortfallCents).toBe(0);
  });
});
