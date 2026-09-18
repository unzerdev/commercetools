/**
 * `paymentAmounts` — the ACTION HEADROOM the merchant panel offers and the intent guard enforces.
 *
 * Two invariants are pinned here, because both rest on them:
 *
 * - What is SPOKEN FOR counts money that is merely IN FLIGHT (`Pending`/`Initial`) as already consumed. The
 *   vendor answers a capture/refund with `CAPTURE_REQUESTED`/`REFUND_REQUESTED` and settles by webhook,
 *   so a headroom that only saw `Success` would still read "nothing refunded yet" moments after a
 *   successful refund — and wave the identical refund through a second time.
 * - What can be GIVEN BACK counts `Charge:Success` only: a capture the vendor accepted but has not settled
 *   is not yet money in, so `refundable` does not offer it.
 *
 * `capturable` is additionally bounded by the AUTHORIZATION: money that was never authorized can never
 * be captured, so a declined payment offers no capture headroom at all.
 */
import { describe, expect, test } from '@jest/globals';
import { paymentAmounts } from '../src/application/orchestration';
import { eur, leg, ownedPayment } from './support/payment-fixtures';

const authorized = (centAmount = 1000) => leg('Authorization', 'Success', centAmount);

describe('paymentAmounts — capture headroom is bounded by the authorization', () => {
  test('no transactions at all → nothing is capturable', () => {
    expect(paymentAmounts(ownedPayment([])).capturable).toStrictEqual(eur(0));
  });

  test('a DECLINED payment (Authorization:Failure) → nothing is capturable', () => {
    const amounts = paymentAmounts(ownedPayment([leg('Authorization', 'Failure', 1000)]));

    expect(amounts.capturable).toStrictEqual(eur(0));
  });

  test('an authorization still PENDING (payment in review) → nothing is capturable yet', () => {
    const amounts = paymentAmounts(ownedPayment([leg('Authorization', 'Pending', 1000)]));

    expect(amounts.capturable).toStrictEqual(eur(0));
  });

  test('a successful authorization opens the headroom', () => {
    expect(paymentAmounts(ownedPayment([authorized()])).capturable).toStrictEqual(eur(1000));
  });

  test('an authorization BELOW the planned amount caps the headroom at what was authorized', () => {
    const payment = ownedPayment([authorized(1000)], { amountPlanned: eur(1500) });

    expect(paymentAmounts(payment).capturable).toStrictEqual(eur(1000));
  });

  test('an auto-capture / SALE payment (captured outright, no Authorization leg) is not broken', () => {
    const amounts = paymentAmounts(ownedPayment([leg('Charge', 'Success', 1000)]));

    // Capturable was already 0 before the authorization bound (planned − settled captures), and stays 0:
    // there is nothing left to capture on a payment the vendor settled in one step, and the money it took
    // is fully refundable.
    expect(amounts.capturable).toStrictEqual(eur(0));
    expect(amounts.refundable).toStrictEqual(eur(1000));
  });
});

describe('paymentAmounts — an in-flight operation consumes the headroom', () => {
  test('a PENDING capture consumes capture headroom (the vendor already accepted it)', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Pending', 600)]));

    expect(amounts.capturable).toStrictEqual(eur(400));
  });

  test('a PENDING refund consumes refund headroom', () => {
    const amounts = paymentAmounts(
      ownedPayment([authorized(), leg('Charge', 'Success', 1000), leg('Refund', 'Pending', 1000)]),
    );

    expect(amounts.refundable).toStrictEqual(eur(0));
  });

  test('a PENDING cancel consumes capture headroom', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('CancelAuthorization', 'Pending', 1000)]));

    expect(amounts.capturable).toStrictEqual(eur(0));
  });

  test('an INITIAL leg consumes headroom too — the operation is out of our hands either way', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Initial', 600)]));

    expect(amounts.capturable).toStrictEqual(eur(400));
  });

  test('a FAILED capture releases the headroom back', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Failure', 600)]));

    expect(amounts.capturable).toStrictEqual(eur(1000));
  });

  test('an unsettled capture is NOT refundable — only settled money can be given back', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Pending', 1000)]));

    expect(amounts.refundable).toStrictEqual(eur(0));
  });
});

describe('paymentAmounts — only settled captures can be given back', () => {
  test('a pending refund consumes the refund headroom without having been given back', () => {
    const amounts = paymentAmounts(
      ownedPayment([authorized(), leg('Charge', 'Success', 1000), leg('Refund', 'Pending', 400)]),
    );

    expect(amounts.refundable).toStrictEqual(eur(600));
  });

  test('a pending capture consumes the capture headroom and is not yet refundable', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Pending', 400)]));

    expect(amounts.capturable).toStrictEqual(eur(600));
    expect(amounts.refundable).toStrictEqual(eur(0));
  });

  // The refund headroom is Σ `Charge:Success` − Σ refunds already taken or in flight, and a
  // `CancelAuthorization` leg belongs to neither sum.
  test('the settled captures minus the refunds already taken is what stays refundable', () => {
    const amounts = paymentAmounts(
      ownedPayment([
        authorized(),
        leg('Charge', 'Success', 600),
        leg('Charge', 'Success', 200),
        leg('Refund', 'Success', 300),
        leg('CancelAuthorization', 'Success', 200),
      ]),
    );

    expect(amounts.refundable).toStrictEqual(eur(500));
  });
});

describe('paymentAmounts — a headroom never goes negative', () => {
  test('a vendor-side over-capture reads as zero headroom, never a phantom credit', () => {
    const amounts = paymentAmounts(ownedPayment([authorized(), leg('Charge', 'Success', 1200)]));

    expect(amounts.capturable).toStrictEqual(eur(0));
  });

  test('a refund beyond what was captured reads as zero refundable', () => {
    const amounts = paymentAmounts(
      ownedPayment([authorized(), leg('Charge', 'Success', 500), leg('Refund', 'Success', 800)]),
    );

    expect(amounts.refundable).toStrictEqual(eur(0));
  });
});

describe('paymentAmounts — the leg the create call opened', () => {
  // The create leg records an accepted-but-unsettled charge as `Charge:Pending` under the vendor's operation id.
  // With no authorization on the payment there is nothing to capture, and money the vendor has not settled is
  // not yet money in: the leg opens no headroom in either direction until the webhook moves it to `Success`.
  test('a create-time Charge:Pending with no authorization grants no capturable and no refundable', () => {
    const amounts = paymentAmounts(ownedPayment([leg('Charge', 'Pending', 1000, 's-chg-1')]));

    expect(amounts.capturable).toStrictEqual(eur(0));
    expect(amounts.refundable).toStrictEqual(eur(0));
  });

  test('once the webhook settles that leg the money is refundable in full', () => {
    const amounts = paymentAmounts(ownedPayment([leg('Charge', 'Success', 1000, 's-chg-1')]));

    expect(amounts.capturable).toStrictEqual(eur(0));
    expect(amounts.refundable).toStrictEqual(eur(1000));
  });
});
