/**
 * How a modification is ROUTED at the vendor: which endpoint, and — for a refund — how many calls.
 *
 * Unzer does not reverse a payment as a whole. A refund is a cancellation ON A CHARGE, bounded by what
 * that charge still holds, so a refund larger than any single capture is several calls with several
 * identities. And a handful of methods are the exception the reference integration carves out: for them
 * the vendor allocates and the connector must NOT split. Both rules are mirrored from
 * `OrderManagementService` in the PHP core so the two connectors move money identically.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { storeConfig } from './support/store-config';
import { PspError } from '../src/providers/psp';
import { PspModificationHandler } from '../src/providers/psp/modifications/modification.handler';
import type { PspClient, UnzerPayment } from '../src/providers/psp/client';

const cfg = storeConfig();
const OPERATION_REFERENCE = 'op-3f2a9c1b7d40-1';
const base = 'https://api.unzer.com/v1/payments/s-pay-1';

const eur = (centAmount: number) => ({ centAmount, currencyCode: 'EUR' });

/** Two settled captures of 50, as the vendor reports them on the payment read. */
const twoCharges: UnzerPayment = {
  id: 's-pay-1',
  currency: 'EUR',
  transactions: [
    { type: 'charge', status: 'success', url: `${base}/charges/c1`, amount: '50.00' },
    { type: 'charge', status: 'success', url: `${base}/charges/c2`, amount: '50.00' },
  ],
} as UnzerPayment;

function handlerFor(payment: UnzerPayment) {
  const get = jest.fn<PspClient['payments']['get']>().mockResolvedValue(payment);
  const refund = jest.fn<PspClient['payments']['refund']>().mockResolvedValue({ id: 'ref-1' });
  const cancelAuthorization = jest
    .fn<PspClient['payments']['cancelAuthorization']>()
    .mockResolvedValue({ id: 'cnl-1', isSuccess: true });
  const client = { payments: { get, refund, cancelAuthorization } } as unknown as Pick<PspClient, 'payments'>;
  return { handler: new PspModificationHandler(client), get, refund, cancelAuthorization };
}

describe('planRefund', () => {
  // The case this exists for: 90 across two captures of 50 is 50 + 40, each against its own charge.
  it('splits a refund across the charges that can carry it', async () => {
    const { handler, get } = handlerFor(twoCharges);

    const plan = await handler.planRefund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: eur(9000),
      fractionDigits: 2,
      paymentMethod: 'card',
    });

    expect(plan).toEqual([
      { targetOperationId: 'c1', amount: eur(5000) },
      { targetOperationId: 'c2', amount: eur(4000) },
    ]);
    // ONE payment read answers the whole question — the charge book and its cancellations ride it.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('resolves to a single call targeted at the one charge that carries the whole amount', async () => {
    const { handler } = handlerFor(twoCharges);

    const plan = await handler.planRefund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: eur(3000),
      fractionDigits: 2,
      paymentMethod: 'card',
    });

    expect(plan).toEqual([{ targetOperationId: 'c1', amount: eur(3000) }]);
  });

  // These five are the reference's `REFUND_VIA_PAYMENT` set: the vendor allocates, so the connector must
  // not — and must not spend a payment read deciding something it does not decide.
  it.each(['paylater-invoice', 'paylater-installment', 'paylater-direct-debit', 'klarna', 'payu'])(
    'leaves the allocation to the vendor for %s',
    async (paymentMethod) => {
      const { handler, get } = handlerFor(twoCharges);

      const plan = await handler.planRefund(cfg, {
        providerPaymentId: 's-pay-1',
        amount: eur(9000),
        fractionDigits: 2,
        paymentMethod,
      });

      expect(plan).toEqual([{ amount: eur(9000) }]);
      expect(get).not.toHaveBeenCalled();
    },
  );

  // The core's headroom guard reads commercetools; only the vendor's charge book knows what the charges
  // still hold. Refusing here is what stops a refund from silently returning part of the money.
  it('refuses when the charges hold less than was asked', async () => {
    const { handler, refund } = handlerFor(twoCharges);

    await expect(
      handler.planRefund(cfg, {
        providerPaymentId: 's-pay-1',
        amount: eur(12000),
        fractionDigits: 2,
        paymentMethod: 'card',
      }),
    ).rejects.toBeInstanceOf(PspError);
    expect(refund).not.toHaveBeenCalled();
  });
});

describe('refund targeting', () => {
  it('cancels against the charge the plan named', async () => {
    const { handler, refund } = handlerFor(twoCharges);

    await handler.refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: eur(4000),
      targetOperationId: 'c2',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(refund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chargeId: 'c2' }));
  });

  it('falls to the payment-level route when the plan named no charge', async () => {
    const { handler, refund } = handlerFor(twoCharges);

    await handler.refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: eur(4000),
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(refund).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ chargeId: expect.anything() }),
    );
  });
});

describe('cancel identifier', () => {
  // Unzer accepts either identifier on this route; the reference addresses the paylater family by the
  // merchant's own order reference, and the two connectors must not diverge on that.
  it.each(['paylater-invoice', 'paylater-installment', 'paylater-direct-debit'])(
    'addresses %s by the merchant order reference',
    async (paymentMethod) => {
      const { handler, cancelAuthorization } = handlerFor(twoCharges);

      await handler.cancel(cfg, {
        providerPaymentId: 's-pay-1',
        merchantOrderId: 'ct-payment-9',
        paymentMethod,
        fractionDigits: 2,
        operationReference: OPERATION_REFERENCE,
      });

      expect(cancelAuthorization).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ paymentId: 'ct-payment-9' }),
      );
    },
  );

  it.each(['card', 'paypal', 'klarna'])('addresses %s by the vendor payment id', async (paymentMethod) => {
    const { handler, cancelAuthorization } = handlerFor(twoCharges);

    await handler.cancel(cfg, {
      providerPaymentId: 's-pay-1',
      merchantOrderId: 'ct-payment-9',
      paymentMethod,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(cancelAuthorization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentId: 's-pay-1' }),
    );
  });

  // Without a merchant reference to fall back on, the vendor id is the only identifier there is.
  it('uses the vendor payment id when no merchant reference travelled', async () => {
    const { handler, cancelAuthorization } = handlerFor(twoCharges);

    await handler.cancel(cfg, {
      providerPaymentId: 's-pay-1',
      paymentMethod: 'paylater-invoice',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(cancelAuthorization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentId: 's-pay-1' }),
    );
  });
});
