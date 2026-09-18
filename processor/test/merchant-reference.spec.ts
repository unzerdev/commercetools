/**
 * The minted names, and the two things they must be at once: a reporting key in the vendor back office,
 * and the idempotency key of a money-moving vendor call.
 *
 * The second role is what these specs are about. Two operations that mint the same name are ONE operation
 * to the vendor: it answers the second call with the first one's result, and the core records a charge
 * that never happened. So the name must separate everything that separates two operations - the payment
 * (over the whole id, never a prefix of it), the operation kind, the payment version and the money it
 * moves - while a replay of one identical intent keeps minting the one name.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { isMintedOperationReference, mintMerchantReference, mintOperationReference } from '../src/domain';
import type { Money } from '../src/domain';

// A realistic commercetools Payment id (UUID v4, 36 chars with dashes).
const CT_PAYMENT_ID = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';

/**
 * Two DIFFERENT payments whose ids agree on their first 12 dash-stripped characters - the pair a
 * prefix-sliced reference cannot tell apart. commercetools mints payment ids the merchant does not choose,
 * but 48 bits of prefix collide on their own: ~0.2% at a million payments.
 */
const PREFIX_TWIN_A = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';
const PREFIX_TWIN_B = 'a1b2c3d4-e5f6-4321-dcba-ba9876543210';

const eur = (centAmount: number): Money => ({ centAmount, currencyCode: 'EUR' });

describe('mintMerchantReference', () => {
  it('keeps the result within 30 chars for realistic inputs (long prefix + full UUID)', () => {
    const ref = mintMerchantReference('psp-commercetools', CT_PAYMENT_ID);
    expect(ref.length).toBeLessThanOrEqual(30);
  });

  it('emits only [A-Za-z0-9-] characters', () => {
    const ref = mintMerchantReference('psp-commercetools', CT_PAYMENT_ID);
    expect(ref).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it('is deterministic - same inputs produce the same ref', () => {
    const a = mintMerchantReference('psp', CT_PAYMENT_ID);
    const b = mintMerchantReference('psp', CT_PAYMENT_ID);
    expect(a).toBe(b);
  });

  it('produces distinct refs for distinct ctPaymentIds', () => {
    const a = mintMerchantReference('psp', 'a1b2c3d4-e5f6-4789-abcd-0123456789ab');
    const b = mintMerchantReference('psp', 'ffffffff-e5f6-4789-abcd-0123456789ab');
    expect(a).not.toBe(b);
  });

  // The payment reference and the names of its operations share ONE stem, so the payment reference is
  // distinct exactly where the operation names are: over the WHOLE id, never a slice of it.
  it('tells two payments apart whose ids share a 12-character prefix', () => {
    expect(mintMerchantReference('psp', PREFIX_TWIN_A)).not.toBe(mintMerchantReference('psp', PREFIX_TWIN_B));
  });

  it('throws a clear error when ctPaymentId is empty', () => {
    expect(() => mintMerchantReference('psp', '')).toThrow(/ctPaymentId/);
  });

  it('sanitizes the brandPrefix - spaces and symbols are stripped, and the case is folded', () => {
    const ref = mintMerchantReference('AB x/@!', CT_PAYMENT_ID);
    // No spaces or symbols leak through; only the alphanumeric part survives (truncated). The case is
    // folded so the brand's DISPLAY value - stamped on `paymentMethodInfo.paymentInterface`, where an
    // operator reads it - may be capitalised without changing the identifier minted from it.
    expect(ref).toMatch(/^[a-z0-9-]+$/);
    expect(ref.startsWith('abx')).toBe(true);
  });

  it('defaults the sequence to 0 when omitted', () => {
    const withDefault = mintMerchantReference('psp', CT_PAYMENT_ID);
    const withZero = mintMerchantReference('psp', CT_PAYMENT_ID);
    expect(withDefault).toBe(withZero);
  });
});

describe('mintOperationReference - the name the core gives ONE modification', () => {
  it('keeps the same alphabet and the same 30-char budget the vendor echoes back', () => {
    const ref = mintOperationReference('psp-commercetools', CT_PAYMENT_ID, 999999, 'Refund', eur(99999999));

    expect(ref.length).toBeLessThanOrEqual(30);
    expect(ref).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it('is deterministic - the same operation on the same payment version mints the same name', () => {
    const a = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Charge', eur(300));
    const b = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Charge', eur(300));

    expect(a).toBe(b);
  });

  it('changes with the payment VERSION - every operation reserves under a version of its own', () => {
    const first = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Refund', eur(300));
    const second = mintOperationReference('psp', CT_PAYMENT_ID, 8, 'Refund', eur(300));

    expect(first).not.toBe(second);
  });

  it('changes with the OPERATION - a capture and a refund at one version are never the same name', () => {
    const version = 7;

    const capture = mintOperationReference('psp', CT_PAYMENT_ID, version, 'Charge', eur(300));
    const refund = mintOperationReference('psp', CT_PAYMENT_ID, version, 'Refund', eur(300));
    const cancel = mintOperationReference('psp', CT_PAYMENT_ID, version, 'CancelAuthorization', eur(300));

    // One name is one idempotency key at the vendor: were these to collide, the vendor would answer the
    // refund with the capture's result.
    expect(new Set([capture, refund, cancel]).size).toBe(3);
  });

  // C2: the Checkout route reserves nothing, so nothing bumps the payment version between the read and the
  // write - two concurrent captures of different amounts read the SAME version. Only the money in the name
  // separates them; without it the vendor performs the 300 and replays that answer to the 200.
  it('changes with the AMOUNT - two captures of different amounts at one version are never the same name', () => {
    const version = 7;

    const three = mintOperationReference('psp', CT_PAYMENT_ID, version, 'Charge', eur(300));
    const two = mintOperationReference('psp', CT_PAYMENT_ID, version, 'Charge', eur(200));

    expect(three).not.toBe(two);
  });

  it('changes with the CURRENCY - the same cent amount in another currency is another operation', () => {
    const euros = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Refund', eur(300));
    const dollars = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Refund', {
      centAmount: 300,
      currencyCode: 'USD',
    });

    expect(euros).not.toBe(dollars);
  });

  it('is distinct across payments', () => {
    const a = mintOperationReference('psp', 'a1b2c3d4-e5f6-4789-abcd-0123456789ab', 1, 'Refund', eur(300));
    const b = mintOperationReference('psp', 'ffffffff-e5f6-4789-abcd-0123456789ab', 1, 'Refund', eur(300));

    expect(a).not.toBe(b);
  });

  // C1: the name is the vendor's idempotency key, so two payments that mint one name are ONE payment to the
  // vendor - payment B's capture is answered with payment A's result. A 12-char PREFIX of the id is 48 bits
  // and collides on birthday bounds alone; the segment is a hash of the WHOLE id.
  it('tells apart two payments whose ids share a 12-character prefix', () => {
    const a = mintOperationReference('psp', PREFIX_TWIN_A, 3, 'Charge', eur(300));
    const b = mintOperationReference('psp', PREFIX_TWIN_B, 3, 'Charge', eur(300));

    expect(a).not.toBe(b);
  });

  it('mints a distinct name for every one of 5000 random payment ids at one version and operation', () => {
    const names = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      names.add(mintOperationReference('psp', randomUUID(), 3, 'Charge', eur(300)));
    }

    expect(names.size).toBe(5000);
  });

  it('throws a clear error when ctPaymentId is empty', () => {
    expect(() => mintOperationReference('psp', '', 1, 'Charge', eur(300))).toThrow(/ctPaymentId/);
  });

  // Truncating the name to fit the budget would silently fold two versions into one idempotency key - the
  // very failure the version is there to prevent. A version the format cannot hold is refused, loudly.
  it('refuses to mint a name the 30-char budget cannot hold', () => {
    expect(() => mintOperationReference('psp', CT_PAYMENT_ID, 1000000, 'Charge', eur(300))).toThrow(/paymentVersion/);
  });
});

describe('isMintedOperationReference - telling OUR name for an operation from anyone else’s', () => {
  it('recognizes a name this very minter produced, at any version and any amount', () => {
    for (const version of [1, 7, 4321]) {
      const ref = mintOperationReference('psp', CT_PAYMENT_ID, version, 'Refund', eur(version * 100));

      expect(isMintedOperationReference('psp', CT_PAYMENT_ID, 'Refund', ref)).toBe(true);
    }
  });

  // A leg this test claims is ours is taken out of reconciliation entirely - never matched against the vendor's
  // operation list - and reported at ERROR as wedged for the life of the payment. So every one of these must
  // fail the test, and a name minted for anything but this exact payment + operation does.
  it('rejects a name minted for a different payment, operation or brand', () => {
    const ref = mintOperationReference('psp', CT_PAYMENT_ID, 7, 'Refund', eur(300));

    expect(isMintedOperationReference('psp', 'ffffffff-e5f6-4789-abcd-0123456789ab', 'Refund', ref)).toBe(false);
    expect(isMintedOperationReference('psp', CT_PAYMENT_ID, 'Charge', ref)).toBe(false);
    expect(isMintedOperationReference('otherbrand', CT_PAYMENT_ID, 'Refund', ref)).toBe(false);
  });

  // The prefix twin is the case a prefix-sliced stem got WRONG: B's leg would be recognized as A's, so a leg
  // the vendor's operation list could have closed would be excluded from reconciliation and alarmed on instead.
  it('rejects a name minted for a payment whose id shares our 12-character prefix', () => {
    const ref = mintOperationReference('psp', PREFIX_TWIN_B, 7, 'Refund', eur(300));

    expect(isMintedOperationReference('psp', PREFIX_TWIN_A, 'Refund', ref)).toBe(false);
  });

  it('rejects a vendor operation id and any other foreign string', () => {
    for (const foreign of ['3237690523_1', 'wl-refund-99', '', 'worldl-a1b2c3d4e5f6-R', 'worldl-a1b2c3d4e5f6-Rx7']) {
      expect(isMintedOperationReference('psp', CT_PAYMENT_ID, 'Refund', foreign)).toBe(false);
    }
  });
});

/**
 * The brand value is BOTH a display name (stamped on `paymentMethodInfo.paymentInterface`, which an
 * operator reads on the Merchant Center payment page) and the seed of every reference minted from it.
 * The two must not be the same string: capitalising the display would otherwise change the reference
 * prefix, and a leg already standing under the old one would stop being recognised by
 * `isMintedOperationReference` - wedged for the life of the payment, with nothing able to clear it.
 */
describe('the brand prefix is case-folded into references', () => {
  const paymentId = '895d830c-870f-41d6-a94e-d31bb402612c';
  const amount = { centAmount: 1500, currencyCode: 'EUR' };

  it('mints the same merchant reference whatever case the brand carries', () => {
    expect(mintMerchantReference('Unzer', paymentId)).toBe(mintMerchantReference('unzer', paymentId));
  });

  it('mints the same operation reference whatever case the brand carries', () => {
    expect(mintOperationReference('Unzer', paymentId, 3, 'Refund', amount)).toBe(
      mintOperationReference('unzer', paymentId, 3, 'Refund', amount),
    );
  });

  // The match side folds identically, so a leg minted before the display was capitalised still matches.
  it('recognises a leg minted under the lowercase prefix', () => {
    const minted = mintOperationReference('unzer', paymentId, 3, 'Refund', amount);

    expect(isMintedOperationReference('Unzer', paymentId, 'Refund', minted)).toBe(true);
  });
});
