/**
 * `POST /operations/payments/:id/intents`: the Merchant Center's capture / refund / cancel channel
 *.
 *
 * The MC cannot mint a commercetools OAuth token, so it cannot reach the certified Checkout route
 * (`POST /operations/payment-intents/:id`); it can only forward a JWT. These specs drive the JWT route
 * through the REAL `createStoreAuthorization` and assert the two properties that make it safe to expose:
 * the store is DERIVED from the payment (a client `X-Store-Key` changes nothing, a payment carrying no
 * `storeKey` is 403), and an over-amount action is rejected 400 BEFORE the provider is called.
 *
 * The last block pins the Checkout route's contract: same fake payment, same over-amount body — it still
 * resolves the DEPLOYMENT store and still reaches the provider. The MC guards must not leak into it.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { type FastifyInstance } from 'fastify';
import { PaymentState } from '../src/domain';
import type { StoreAuthorizationDeps } from '../src/infrastructure/http/authorization/store-authorization';
import { makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import {
  bearerWithPermissions,
  buildOperationsApp,
  DEPLOYMENT_STORE_KEY,
  failJwtHook,
  manageHeaders,
} from './support/operations-app';
import {
  cancelIntent,
  captureIntent,
  eur,
  leg,
  partlySettledPayment,
  PAYMENT_STORE_KEY,
  refundIntent,
} from './support/payment-fixtures';

describe('POST /operations/payments/:id/intents (Merchant Center)', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;

  const buildApp = (jwtAuthHook?: unknown): Promise<FastifyInstance> =>
    buildOperationsApp({ ports, provider, storeExists, jwtAuthHook });

  const givenPayment = (payment: unknown): void => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(payment as never);
  };

  const noProviderCall = (): void => {
    expect(provider.modifications.capture).not.toHaveBeenCalled();
    expect(provider.modifications.refund).not.toHaveBeenCalled();
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
    // Nor is anything written ahead of it: a rejected intent leaves no reserved leg holding the headroom.
    expect(ports.paymentStore.reserve).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(true);
    givenPayment(partlySettledPayment());
  });

  describe('authorization', () => {
    test('without a JWT → 401; the payment is never even read', async () => {
      const app = await buildApp(failJwtHook);

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(100),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(401);
      expect(ports.paymentStore.get).not.toHaveBeenCalled();
      noProviderCall();
      await app.close();
    });

    test('WITHOUT the manage permission → 403; the provider is never called', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(100),
        headers: { authorization: bearerWithPermissions(['canViewPspPayments']) },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.paymentStore.get).not.toHaveBeenCalled();
      noProviderCall();
      await app.close();
    });

    test('a payment with NO storeKey custom field → 403; no store config is resolved and no provider call is made', async () => {
      givenPayment(partlySettledPayment({ custom: { fields: {} } }));
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(100),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configResolver.resolve).not.toHaveBeenCalled();
      noProviderCall();
      await app.close();
    });
  });

  describe('amount guard — rejected BEFORE any vendor call', () => {
    test('a capture above the remaining capturable amount → 400', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(501),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(400);
      noProviderCall();
      await app.close();
    });

    test('a cancelled authorization consumes the capture headroom → 400', async () => {
      givenPayment(
        partlySettledPayment({
          transactions: [leg('Authorization', 'Success', 1500), leg('CancelAuthorization', 'Success', 1500)],
        }),
      );
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(100),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(400);
      noProviderCall();
      await app.close();
    });

    test('a refund above what is captured (minus what is already refunded) → 400', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: refundIntent(601),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(400);
      noProviderCall();
      await app.close();
    });

    test('a non-positive amount → 400', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(0),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(400);
      noProviderCall();
      await app.close();
    });

    test("an amount in another currency than the payment's → 400", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: { actions: [{ action: 'capturePayment', amount: { centAmount: 100, currencyCode: 'USD' } }] },
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(400);
      noProviderCall();
      await app.close();
    });
  });

  describe('happy paths — the same modifyPayment orchestration, on the payment’s own store', () => {
    test('capture at exactly the remaining amount → 200 and a Charge transaction on the payment', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(500),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'approved' });
      expect(provider.modifications.capture).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        amount: 500,
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
      // The Charge leg is RESERVED before the vendor is called and SETTLED by its answer — never appended
      // afterwards, which would count the same money twice.
      expect(ports.paymentStore.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pay-1',
          version: 1,
          transaction: expect.objectContaining({ type: 'Charge', amount: eur(500) }),
        }),
      );
      // Settled by the HANDLE it was reserved under — the leg's type and the name the reservation minted.
      expect(ports.paymentStore.settle).toHaveBeenCalledWith(
        'pay-1',
        { type: 'Charge', interactionId: expect.any(String) },
        { state: 'Success', providerOperationId: 'cap-1' },
      );
      expect(ports.paymentStore.update).not.toHaveBeenCalled();
      await app.close();
    });

    test('refund within the refundable amount → 200', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: refundIntent(600),
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'approved' });
      expect(provider.modifications.refund).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        amount: eur(600),
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
      await app.close();
    });

    test('cancel → 200 (no amount to guard)', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CANCELLED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: cancelIntent,
        headers: manageHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.cancel).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        // Both identifiers travel: the core does not know which one this method is addressed by.
        merchantOrderId: 'pay-1',
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
      await app.close();
    });

    test('the store config resolved is the PAYMENT’s store — the deployment key is never consulted', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(500),
        headers: manageHeaders,
      });

      expect(ports.configResolver.resolve).toHaveBeenCalledWith(PAYMENT_STORE_KEY);
      expect(ports.configResolver.resolve).toHaveBeenCalledTimes(1);
      expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
      await app.close();
    });

    test('a client-sent X-Store-Key is IGNORED — the payment decides which store is served', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(500),
        headers: { 'X-Store-Key': 'store-of-another-merchant', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configResolver.resolve).toHaveBeenCalledWith(PAYMENT_STORE_KEY);
      expect(ports.configResolver.resolve).not.toHaveBeenCalledWith('store-of-another-merchant');
      await app.close();
    });

    test('call budget: the guarded action costs ONE commercetools payment read', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/operations/payments/pay-1/intents',
        payload: captureIntent(500),
        headers: manageHeaders,
      });

      expect(ports.paymentStore.get).toHaveBeenCalledTimes(1);
      await app.close();
    });
  });

  // The certified Checkout contract (OAuth2): the MC route's guards are confined to the MC route. Same
  // payment, same over-amount body — Checkout still resolves the DEPLOYMENT store and still reaches the
  // provider, so a legitimate capture is never rejected because CT transactions lag the vendor.
  describe('the Checkout route stays byte-identical', () => {
    test('POST /operations/payment-intents/:id resolves the deployment store, not the payment’s', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payment-intents/pay-1',
        payload: captureIntent(500),
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configResolver.resolve).toHaveBeenCalledWith(DEPLOYMENT_STORE_KEY);
      await app.close();
    });

    test('POST /operations/payment-intents/:id applies NO amount guard — an over-amount capture still reaches the provider', async () => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payment-intents/pay-1',
        payload: captureIntent(1500),
      });

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.capture).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        amount: 1500,
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
      // And it reserves nothing: no leg is written ahead of the vendor on the Checkout route.
      expect(ports.paymentStore.reserve).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
