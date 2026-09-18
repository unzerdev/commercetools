/**
 * Unit tests for the shopper/return config-resolution seams: the store is derived from
 * the CART for shopper calls and from the PAYMENT for the return leg, each falling back to the
 * no-store `resolveDefault()` when no store key is present.
 */
import { describe, expect, jest, test } from '@jest/globals';
import type { Cart } from '@commercetools/connect-payments-sdk';
import { resolvePaymentConfig, resolveShopperConfig } from '../src/application/orchestration';
import { PAYMENT_STORE_KEY_FIELD } from '../src/domain';
import type { ConfigResolver, Payment } from '../src/application/ports';
import type { StoreConfig } from '../src/domain';

/** A ConfigResolver whose two async methods are distinguishable by the storeKey they stamp. */
function fakeResolver(): ConfigResolver {
  return {
    resolve: jest.fn<ConfigResolver['resolve']>(async (storeKey) => ({ storeKey }) as StoreConfig),
    resolveDefault: jest.fn<ConfigResolver['resolveDefault']>(async () => ({ storeKey: 'DEFAULT' }) as StoreConfig),
    storeKey: jest.fn<ConfigResolver['storeKey']>(() => 'project-key'),
  };
}

describe('resolveShopperConfig — store derived from the cart', () => {
  test('cart with a store → resolve(that store); resolveDefault NOT called', async () => {
    const resolver = fakeResolver();
    const cart = { store: { typeId: 'store', key: 'store-42' } } as unknown as Cart;

    const cfg = await resolveShopperConfig(cart, resolver);

    expect(resolver.resolve).toHaveBeenCalledWith('store-42');
    expect(cfg.storeKey).toBe('store-42');
    expect(resolver.resolveDefault).not.toHaveBeenCalled();
  });

  test('cart with no store → resolveDefault(); resolve NOT called (no Custom Object read)', async () => {
    const resolver = fakeResolver();
    const cart = {} as unknown as Cart;

    const cfg = await resolveShopperConfig(cart, resolver);

    expect(resolver.resolveDefault).toHaveBeenCalledTimes(1);
    expect(cfg.storeKey).toBe('DEFAULT');
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});

describe('resolvePaymentConfig — store derived from the payment stamp', () => {
  test('payment with a stamped storeKey → resolve(that store)', async () => {
    const resolver = fakeResolver();
    const payment = { custom: { fields: { [PAYMENT_STORE_KEY_FIELD]: 'store-x' } } } as unknown as Payment;

    const cfg = await resolvePaymentConfig(payment, resolver);

    expect(resolver.resolve).toHaveBeenCalledWith('store-x');
    expect(cfg.storeKey).toBe('store-x');
    expect(resolver.resolveDefault).not.toHaveBeenCalled();
  });

  test('payment with no stamped storeKey (legacy) → resolveDefault()', async () => {
    const resolver = fakeResolver();
    const payment = { custom: { fields: {} } } as unknown as Payment;

    const cfg = await resolvePaymentConfig(payment, resolver);

    expect(resolver.resolveDefault).toHaveBeenCalledTimes(1);
    expect(cfg.storeKey).toBe('DEFAULT');
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
