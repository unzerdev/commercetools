/**
 * The commercetools port adapters delegate to their backing service faithfully. These assert delegation
 * against a fake backing, not the backing's own behaviour, which its own suite covers. The repositories
 * that implement a port directly (config, payment methods, webhook markers) have no adapter to check.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { CommercetoolsCartService, CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';
import { CartReaderAdapter } from '../src/infrastructure/adapters/cart-reader.adapter';
import { PaymentStoreAdapter } from '../src/infrastructure/adapters/payment-store.adapter';
import * as paymentRepository from '../src/infrastructure/commercetools/payments.repository';

describe('core/adapters - CartReaderAdapter', () => {
  it('delegates getCart / getPaymentAmount / addPayment to the CT cart service', async () => {
    const cart = { id: 'cart-1', version: 3 };
    const amount = { centAmount: 1099, currencyCode: 'EUR' };
    const getCart = jest.fn<(opts: unknown) => Promise<unknown>>().mockResolvedValue(cart);
    const getPaymentAmount = jest.fn<(opts: unknown) => Promise<unknown>>().mockResolvedValue(amount);
    const addPayment = jest.fn<(opts: unknown) => Promise<unknown>>().mockResolvedValue(cart);
    const ctCartService = { getCart, getPaymentAmount, addPayment } as unknown as CommercetoolsCartService;

    const adapter = new CartReaderAdapter(ctCartService);

    await expect(adapter.getCart('cart-1')).resolves.toBe(cart);
    expect(getCart).toHaveBeenCalledWith({ id: 'cart-1' });

    await expect(adapter.getPaymentAmount(cart as never)).resolves.toBe(amount);
    expect(getPaymentAmount).toHaveBeenCalledWith({ cart });

    await adapter.addPayment({ id: 'cart-1', version: 3 }, 'pay-1');
    expect(addPayment).toHaveBeenCalledWith({ resource: { id: 'cart-1', version: 3 }, paymentId: 'pay-1' });
  });
});

describe('core/adapters - PaymentStoreAdapter', () => {
  it('delegates create / update / get / hasTransactionInState to the CT payment service', async () => {
    const payment = { id: 'pay-1' };
    const createPayment = jest.fn<(draft: unknown) => Promise<unknown>>().mockResolvedValue(payment);
    const updatePayment = jest.fn<(opts: unknown) => Promise<unknown>>().mockResolvedValue(payment);
    const getPayment = jest.fn<(opts: unknown) => Promise<unknown>>().mockResolvedValue(payment);
    const hasTransactionInState = jest.fn<(opts: unknown) => boolean>().mockReturnValue(true);
    const ctPaymentService = {
      createPayment,
      updatePayment,
      getPayment,
      hasTransactionInState,
    } as unknown as CommercetoolsPaymentService;

    const adapter = new PaymentStoreAdapter(ctPaymentService);

    await adapter.create({ amountPlanned: {} } as never);
    expect(createPayment).toHaveBeenCalledWith({ amountPlanned: {} });

    await adapter.update({ id: 'pay-1' } as never);
    expect(updatePayment).toHaveBeenCalledWith({ id: 'pay-1' });

    await expect(adapter.get('pay-1')).resolves.toBe(payment);
    expect(getPayment).toHaveBeenCalledWith({ id: 'pay-1' });

    expect(adapter.hasTransactionInState({ payment } as never)).toBe(true);
    expect(hasTransactionInState).toHaveBeenCalledWith({ payment });
  });

  it('findByMerchantReference delegates to the raw-client payment repository (SDK offers no such query)', async () => {
    const payment = { id: 'pay-1' };
    const spy = jest.spyOn(paymentRepository, 'findPaymentByMerchantReference').mockResolvedValue(payment as never);
    const adapter = new PaymentStoreAdapter({} as unknown as CommercetoolsPaymentService);

    await expect(adapter.findByMerchantReference('ref-1', 'store-1')).resolves.toBe(payment);
    expect(spy).toHaveBeenCalledWith('ref-1', 'store-1');
    spy.mockRestore();
  });

  it('setReviewFlag delegates to the raw-client setCustomField merge in the payment repository', async () => {
    const spy = jest.spyOn(paymentRepository, 'setPaymentReviewFlag').mockResolvedValue(undefined);
    const adapter = new PaymentStoreAdapter({} as unknown as CommercetoolsPaymentService);

    await adapter.setReviewFlag('pay-1');
    expect(spy).toHaveBeenCalledWith('pay-1');
    spy.mockRestore();
  });
});
