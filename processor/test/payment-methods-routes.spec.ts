/**
 * HTTP-layer coverage for the merchant `GET`/`PUT /operations/payment-methods` endpoints, thin
 * over the `application/orchestration/payment-methods` functions. These specs assert the ROUTE / AUTH /
 * SCHEMA wiring only — the merge/persist logic is covered by `orchestration-payment-methods.spec`. The
 * routes run behind the SAME store-scoped guard bundle as store-config (jwt + audience +
 * manage-permission + existing-store). Fake `CorePorts` + `ProviderModule` + env are injected exactly as
 * production wires them, so no commercetools access happens.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorAuthErrorResponse } from '@commercetools/connect-payments-sdk';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { operationsRoute } from '../src/infrastructure/http/routes/operation.route';
import type { StoreAuthorization } from '../src/infrastructure/http/authorization/store-authorization';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

const passHook = { authenticate: () => async () => {} };
const authorizeHook = { authorize: () => async () => {} };
const failJwt = {
  authenticate: () => async () => {
    throw new ErrorAuthErrorResponse('Unauthorized.', undefined, 'Unauthorized');
  },
};

const passStoreAuthorization: StoreAuthorization = {
  requireExistingStore: async () => {},
  requireManagePermission: async () => {},
  requireMatchingAudience: async () => {},
};

describe('operations payment-methods routes (/operations/payment-methods)', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;

  async function buildApp(jwtHook: {
    authenticate: () => (req: unknown, reply: unknown) => Promise<void>;
  }): Promise<FastifyInstance> {
    const fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(operationsRoute, {
      prefix: '/operations',
      ports,
      provider,
      env: makeFakeEnv(),
      jwtAuthHook: jwtHook as never,
      oauth2AuthHook: passHook as never,
      sessionHeaderAuthHook: passHook as never,
      authorizationHook: authorizeHook as never,
      storeAuthorization: passStoreAuthorization,
    });
    await fastify.ready();
    return fastify;
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
  });

  // A schema-valid method config the PUT gate accepts.
  const validMethod = {
    paymentMethodCode: 'card',
    enabled: true,
    name: { en: 'Card' },
    description: { en: 'Pay by card' },
    surcharge: { EUR: 0 },
    countries: [] as string[],
    sendBasketData: false,
  };

  describe('GET /operations/payment-methods', () => {
    test('without a JWT → 401 and the catalogue is never read', async () => {
      const app = await buildApp(failJwt as never);

      const res = await app.inject({ method: 'GET', url: '/operations/payment-methods' });

      expect(res.statusCode).toBe(401);
      expect(provider.introspection.availableMethods).not.toHaveBeenCalled();
      expect(ports.paymentMethodsStore.readWithVersion).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT → 200 returns the merged { paymentMethods } list', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-methods',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().paymentMethods.map((m: { paymentMethodCode: string }) => m.paymentMethodCode)).toEqual([
        'card',
      ]);
      // The GET view carries the read-only two-step capability the settings modal gates the booking control on.
      expect(res.json().paymentMethods[0].supportsAuthorize).toBe(true);
      await app.close();
    });

    test('with an X-Store-Key header → reads THAT store', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-methods',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.paymentMethodsStore.readWithVersion).toHaveBeenCalledWith('store-42');
      await app.close();
    });

    test('?mode=live forwards the environment so the catalogue resolves for live', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-methods?mode=live',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      // The route hands `?mode=` to the orchestration, which resolves the config forced to that env.
      expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42', 'live');
      await app.close();
    });

    test('an out-of-set ?mode= → 400 at the schema gate; the catalogue is never read', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-methods?mode=prod',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(400);
      expect(ports.paymentMethodsStore.readWithVersion).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('PUT /operations/payment-methods', () => {
    test('without a JWT → 401 and nothing is persisted', async () => {
      const app = await buildApp(failJwt as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/payment-methods',
        payload: { paymentMethods: [validMethod] },
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(401);
      expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT + valid body + X-Store-Key → 200 and the config is persisted to THAT store', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/payment-methods',
        payload: { paymentMethods: [validMethod] },
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.paymentMethodsStore.readWithVersion).toHaveBeenCalledWith('store-42');
      expect(ports.paymentMethodsStore.write).toHaveBeenCalledTimes(1);
      await app.close();
    });

    test('without an X-Store-Key header → 400 (the project key is reserved), nothing persisted', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/payment-methods',
        payload: { paymentMethods: [validMethod] },
      });

      expect(res.statusCode).toBe(400);
      expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('?mode=live persists the payload to the live environment', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/payment-methods?mode=live',
        payload: { paymentMethods: [validMethod] },
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      const [, written] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
        string,
        { environments: { live?: { paymentMethods: unknown[] } } },
        number | undefined,
      ];
      // The route's `?mode=` targets the write at the live environment's list.
      expect(written.environments.live?.paymentMethods).toEqual([validMethod]);
      await app.close();
    });

    test('an invalid body (missing the required surcharge) → 400 at the schema gate; nothing persisted', async () => {
      const app = await buildApp(passHook as never);

      // Omit the required `surcharge` leaf — the strict schema rejects the object at the gate.
      const withoutSurcharge = {
        paymentMethodCode: 'card',
        enabled: true,
        name: { en: 'Card' },
        description: { en: 'Pay by card' },
        countries: [] as string[],
      };
      const res = await app.inject({
        method: 'PUT',
        url: '/operations/payment-methods',
        payload: { paymentMethods: [withoutSurcharge] },
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(400);
      expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
