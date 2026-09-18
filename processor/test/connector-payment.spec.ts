/**
 * The single derivation both Merchant Center paths make from a CT Payment: "whose is it, and whose PSP
 * account holds it?".
 *
 * ONE definition serves the read path (the MC panel's `getOrderPayments`) and the action path
 * (`applyMerchantIntent`), so the panel can only ever list payments the action route will accept, and it
 * reads them through the credentials the action would write with. The answer is the `storeKey` custom field
 * — NOT `paymentMethodInfo.paymentInterface`, which the certified `/operations/transactions` route stamps
 * with Checkout's connector uuid rather than the brand string. A payment that names no store is not ours.
 */
import { describe, expect, test } from '@jest/globals';
import { connectorStoreKey } from '../src/application/orchestration';
import { fakePayment } from './support/fake-provider-module';

const withFields = (fields: Record<string, unknown>): any => fakePayment({ custom: { fields } });

describe('connectorStoreKey', () => {
  test('a non-empty storeKey custom field names the store — and IS the ownership test', () => {
    expect(connectorStoreKey(withFields({ storeKey: 'store-a' }))).toBe('store-a');
  });

  test('ownership does not depend on paymentInterface: a foreign uuid still owns when storeKey is stamped', () => {
    const payment = fakePayment({
      paymentMethodInfo: { paymentInterface: '2f9a1c34-9b7e-4d1a-8f2b-6c5d4e3a2b10' },
      custom: { fields: { storeKey: 'store-a' } },
    });

    expect(connectorStoreKey(payment)).toBe('store-a');
  });

  test('the brand paymentInterface alone does NOT own: without storeKey the payment is not actionable', () => {
    expect(connectorStoreKey(fakePayment({ paymentMethodInfo: { paymentInterface: 'psp' } }))).toBeUndefined();
  });

  test('an absent, empty or wrong-typed storeKey never owns', () => {
    expect(connectorStoreKey(fakePayment({ custom: undefined }))).toBeUndefined();
    expect(connectorStoreKey(withFields({}))).toBeUndefined();
    expect(connectorStoreKey(withFields({ storeKey: '' }))).toBeUndefined();
    expect(connectorStoreKey(withFields({ storeKey: 42 }))).toBeUndefined();
  });
});
