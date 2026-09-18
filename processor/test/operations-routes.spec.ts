import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorAuthErrorResponse } from '@commercetools/connect-payments-sdk';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { operationsRoute } from '../src/infrastructure/http/routes/operation.route';
import type { StoreAuthorization } from '../src/infrastructure/http/authorization/store-authorization';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

/**
 * HTTP-layer coverage for the merchant `/operations/*` config endpoints, now thin over the
 * `application/orchestration/*` functions. These specs assert the ROUTE / AUTH / SCHEMA wiring only —
 * the orchestration logic itself is covered by `orchestration-config.spec` +
 * `vendor-config-handler.spec`. Fake `CorePorts` + `ProviderModule` + env are injected exactly as
 * production wires them (`{ ports, provider, env, ...authHooks }`), so no commercetools access happens.
 *
 * NOTE on store-config validation: strict settings validation now lives in the `updateStoreConfig`
 * orchestrator (`provider.config.validate` → `ErrorInvalidOperation` → 400), NOT in the fastify body
 * schema gate (which accepts `settings` as opaque `unknown`). The PUT-invalid case below asserts the
 * 400 surfaces from that orchestrator path on a body that passes the schema gate.
 */

// A JWT hook that authenticates (no-op) and one that rejects — matching the production hook contract.
const passHook = { authenticate: () => async () => {} };
const authorizeHook = { authorize: () => async () => {} };
const failJwt = {
  authenticate: () => async () => {
    throw new ErrorAuthErrorResponse('Unauthorized.', undefined, 'Unauthorized');
  },
};

// A pass-through store authorization — the store-existence, manage-permission and audience gates are
// covered by `store-authorization-routes.spec` / `audience-authorization.spec`; these specs assert the
// ROUTE / AUTH / SCHEMA wiring only. Typed (not cast) so a new gate breaks the build, not the runtime.
const passStoreAuthorization: StoreAuthorization = {
  requireExistingStore: async () => {},
  requireManagePermission: async () => {},
  requireMatchingAudience: async () => {},
};

describe('operations config routes (/operations/*)', () => {
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
  });

  describe('GET /operations/store-config', () => {
    test('without a JWT → 401 and the config store is never read', async () => {
      const app = await buildApp(failJwt as never);

      const res = await app.inject({ method: 'GET', url: '/operations/store-config' });

      expect(res.statusCode).toBe(401);
      expect(ports.configStore.read).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT → 200 returns the config with secrets redacted to ***', async () => {
      ports.configStore.read = jest.fn<typeof ports.configStore.read>().mockResolvedValue({
        mode: 'sandbox',
        environments: { sandbox: { credentials: { publicKey: 'pub', privateKey: 'shh' } } },
      });
      // The provider ConfigHandler owns the masking; core relays its redacted view verbatim.
      provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({
        mode: 'sandbox',
        environments: { sandbox: { credentials: { publicKey: '***', privateKey: '***' } } },
      });
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'GET', url: '/operations/store-config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.environments.sandbox.credentials.privateKey).toBe('***');
      // The plaintext secret never crosses the boundary.
      expect(res.payload).not.toContain('shh');
      await app.close();
    });

    test('with an X-Store-Key header → reads the config for THAT store', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.read).toHaveBeenCalledWith('store-42');
      await app.close();
    });

    test('without an X-Store-Key header → falls back to the deployment store key', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'GET', url: '/operations/store-config' });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.read).toHaveBeenCalledWith('store-1');
      await app.close();
    });
  });

  describe('PUT /operations/store-config', () => {
    // A schema-valid body: `mode` is a legal literal and `settings` is opaque `unknown` at the
    // fastify gate. Whether the settings are semantically valid is decided by the orchestrator.
    const validBody = { mode: 'sandbox', settings: {} };

    test('without a JWT → 401 and nothing is persisted', async () => {
      const app = await buildApp(failJwt as never);

      const res = await app.inject({ method: 'PUT', url: '/operations/store-config', payload: validBody });

      expect(res.statusCode).toBe(401);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT + valid settings → 200 and the redacted saved config is returned', async () => {
      // provider.config.validate defaults to { valid: true }.
      provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validBody,
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(provider.config.validate).toHaveBeenCalledTimes(1);
      expect(ports.configStore.write).toHaveBeenCalledTimes(1);
      expect(res.json()).toStrictEqual({ mode: 'sandbox' });
      await app.close();
    });

    test('with an X-Store-Key header → persists to THAT store', async () => {
      provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validBody,
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.readWithVersion).toHaveBeenCalledWith('store-42');
      expect(ports.configStore.write).toHaveBeenCalledWith('store-42', expect.anything(), undefined);
      await app.close();
    });

    test('without an X-Store-Key header → 400 (the project key is reserved), nothing persisted', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'PUT', url: '/operations/store-config', payload: validBody });

      expect(res.statusCode).toBe(400);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT + invalid settings → 400 from the orchestrator (not the schema gate); nothing is persisted', async () => {
      // The body passes the fastify schema gate; strict validation happens in the orchestrator.
      provider.config.validate = jest
        .fn<typeof provider.config.validate>()
        .mockReturnValue({ valid: false, errors: ['flows: unexpected property'] });
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validBody,
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(400);
      expect(provider.config.validate).toHaveBeenCalledTimes(1);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('POST /operations/testconnection', () => {
    test('without a JWT → 401 and the probe is never run', async () => {
      const app = await buildApp(failJwt as never);

      const res = await app.inject({ method: 'POST', url: '/operations/testconnection' });

      expect(res.statusCode).toBe(401);
      expect(provider.introspection.testConnection).not.toHaveBeenCalled();
      await app.close();
    });

    test('with a JWT → 200 relays the provider probe success shape', async () => {
      // provider.introspection.testConnection defaults to { success: true }.
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'POST', url: '/operations/testconnection' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ success: true });
      await app.close();
    });

    test('with a JWT → 200 relays the provider probe FAILURE shape (secret-free)', async () => {
      provider.introspection.testConnection = jest
        .fn<typeof provider.introspection.testConnection>()
        .mockResolvedValue({ success: false, message: 'bad creds' });
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'POST', url: '/operations/testconnection' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ success: false, message: 'bad creds' });
      await app.close();
    });

    test('with an X-Store-Key header → probes THAT store, not the deployment default', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'POST',
        url: '/operations/testconnection',
        headers: { 'X-Store-Key': 'store-42' },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42');
      await app.close();
    });

    test('without an X-Store-Key header → falls back to the deployment store key', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({ method: 'POST', url: '/operations/testconnection' });

      expect(res.statusCode).toBe(200);
      expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-1');
      await app.close();
    });
  });

  describe('POST /operations/payment-intents/:id', () => {
    // The certified Checkout route. An empty batch has no action to run, so it must die at the schema
    // gate: the dispatch below it takes `actions[0]` and would otherwise fault AFTER a commercetools read.
    test('an EMPTY actions array → 400 at the schema gate; the payment is never read', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payment-intents/pay-1',
        payload: { actions: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(ports.paymentStore.get).not.toHaveBeenCalled();
      await app.close();
    });

    test('a single valid action passes the schema gate and reaches the dispatch', async () => {
      const app = await buildApp(passHook as never);

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payment-intents/pay-1',
        payload: { actions: [{ action: 'capturePayment', amount: { centAmount: 1500, currencyCode: 'EUR' } }] },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.paymentStore.get).toHaveBeenCalledWith('pay-1');
      await app.close();
    });
  });
});
