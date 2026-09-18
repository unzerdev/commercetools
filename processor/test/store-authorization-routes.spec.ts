import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { operationsRoute } from '../src/infrastructure/http/routes/operation.route';
import {
  createStoreAuthorization,
  type StoreAuthorizationDeps,
} from '../src/infrastructure/http/authorization/store-authorization';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { FORWARD_TO_AUDIENCE, PUBLIC_ORIGIN } from './support/operations-app';

/**
 * Store-level authorization over the merchant `/operations/*` config endpoints (SEC hardening #1),
 * driving the REAL `createStoreAuthorization` through the routes with a mocked store existence checker
 * and a crafted (unsigned, already-"validated") Bearer JWT carrying the operator's permissions under
 * the issuer-namespaced `<iss>/claims/user_permissions` claim of the forward-to exchange token.
 *
 * The JWT auth hook is a no-op here (the SDK hook's signature/issuer validation is the SDK's concern);
 * these specs assert the authorization LAYER: store-existence (fail-closed 403 on an unknown store) and
 * the manage-permission gate on the privileged mutations. The deployment-default key skips the remote
 * probe (trusted config), so the single-store fallback keeps working.
 */

const passHook = { authenticate: () => async () => {} };
const authorizeHook = { authorize: () => async () => {} };

const DEFAULT_STORE_KEY = 'store-1';
const MANAGE_PERMISSION = 'canManagePspPayments';

const ISSUER = 'https://mc-api.europe-west1.gcp.commercetools.com';

/** A crafted Bearer token with an arbitrary (unsigned) payload, for exchange-token shape cases. */
const bearerWithPayload = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `Bearer ${header}.${payload}.`;
};

/** A crafted Bearer token carrying the given MC permissions under the issuer-namespaced
 * `<iss>/claims/user_permissions` claim and the `aud` the gateway stamps, mirroring the documented
 * forward-to exchange token. */
const bearerWithPermissions = (permissions: string[] | undefined): string =>
  bearerWithPayload(
    permissions === undefined
      ? { iss: ISSUER, type: 'exchange', aud: FORWARD_TO_AUDIENCE }
      : {
          iss: ISSUER,
          type: 'exchange',
          aud: FORWARD_TO_AUDIENCE,
          [`${ISSUER}/claims/user_permissions`]: permissions,
        },
  );

describe('operations config routes — store-level authorization', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;

  async function buildApp(): Promise<FastifyInstance> {
    const fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(operationsRoute, {
      prefix: '/operations',
      ports,
      provider,
      env: makeFakeEnv(),
      jwtAuthHook: passHook as never,
      oauth2AuthHook: passHook as never,
      sessionHeaderAuthHook: passHook as never,
      authorizationHook: authorizeHook as never,
      storeAuthorization: createStoreAuthorization({
        storeChecker: { storeExists },
        defaultStoreKey: () => DEFAULT_STORE_KEY,
        managePermission: MANAGE_PERMISSION,
        publicOrigin: () => PUBLIC_ORIGIN,
        logger: { warn: () => {} },
      }),
    });
    await fastify.ready();
    return fastify;
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    // Unknown by default; individual tests opt a store into existence.
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(false);
    provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });
  });

  const validPutBody = { mode: 'sandbox', settings: {} };
  const manageHeaders = { authorization: bearerWithPermissions([MANAGE_PERMISSION]) };

  describe('store-existence (fail-closed)', () => {
    test('GET store-config with an unknown X-Store-Key → 403; the config store is never read', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'ghost-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(403);
      expect(storeExists).toHaveBeenCalledWith('ghost-store');
      expect(ports.configStore.read).not.toHaveBeenCalled();
      await app.close();
    });

    test('GET store-config with a KNOWN X-Store-Key → 200 and reads that store', async () => {
      storeExists.mockResolvedValue(true);
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.read).toHaveBeenCalledWith('real-store');
      await app.close();
    });

    test('PUT store-config with an unknown X-Store-Key → 403; nothing is persisted', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: { 'X-Store-Key': 'ghost-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('POST testconnection with an unknown X-Store-Key → 403; the probe never runs', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/testconnection',
        headers: { 'X-Store-Key': 'ghost-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(403);
      expect(provider.introspection.testConnection).not.toHaveBeenCalled();
      await app.close();
    });

    test('a lookup FAILURE fails closed → 403', async () => {
      storeExists.mockRejectedValue(new Error('commercetools unreachable'));
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    test('the deployment-default fallback skips the remote probe (single-store) → 200', async () => {
      const app = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/operations/store-config', headers: manageHeaders });

      expect(res.statusCode).toBe(200);
      expect(storeExists).not.toHaveBeenCalled();
      expect(ports.configStore.read).toHaveBeenCalledWith(DEFAULT_STORE_KEY);
      await app.close();
    });

    test('a positive lookup is cached — repeated requests hit commercetools once', async () => {
      storeExists.mockResolvedValue(true);
      const app = await buildApp();

      const headers = { 'X-Store-Key': 'real-store', ...manageHeaders };
      await app.inject({ method: 'GET', url: '/operations/store-config', headers });
      await app.inject({ method: 'GET', url: '/operations/store-config', headers });

      expect(storeExists).toHaveBeenCalledTimes(1);
      await app.close();
    });
  });

  describe('manage-permission (fail-closed)', () => {
    beforeEach(() => {
      // A real, existing store so the manage-permission gate (not store-existence) decides these cases.
      storeExists.mockResolvedValue(true);
    });

    test('PUT store-config WITHOUT the manage permission → 403; nothing is persisted', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions(['canViewPspPayments']) },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('PUT store-config with an ABSENT permissions claim → 403', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions(undefined) },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('PUT store-config with the permissions under a BARE `permissions` claim → 403 (only the namespaced claim counts)', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: {
          'X-Store-Key': 'real-store',
          authorization: bearerWithPayload({
            iss: ISSUER,
            type: 'exchange',
            aud: FORWARD_TO_AUDIENCE,
            permissions: [MANAGE_PERMISSION],
          }),
        },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('PUT store-config with a payload MISSING `iss` → 403 (fail closed)', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: {
          'X-Store-Key': 'real-store',
          authorization: bearerWithPayload({
            type: 'exchange',
            aud: FORWARD_TO_AUDIENCE,
            [`${ISSUER}/claims/user_permissions`]: [MANAGE_PERMISSION],
          }),
        },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.write).not.toHaveBeenCalled();
      await app.close();
    });

    test('PUT store-config WITH the manage permission → 200 and persists', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: validPutBody,
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.write).toHaveBeenCalledTimes(1);
      await app.close();
    });

    test('POST testconnection WITHOUT the manage permission → 403; the probe never runs', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/testconnection',
        headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions([]) },
      });

      expect(res.statusCode).toBe(403);
      expect(provider.introspection.testConnection).not.toHaveBeenCalled();
      await app.close();
    });

    test('GET store-config WITHOUT the manage permission → 403; the config store is never read', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions([]) },
      });

      expect(res.statusCode).toBe(403);
      expect(ports.configStore.read).not.toHaveBeenCalled();
      await app.close();
    });

    test('GET store-config WITH the manage permission → 200 and reads that store', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.read).toHaveBeenCalledWith('real-store');
      await app.close();
    });

    // The connector's health is merchant reconnaissance — the required commercetools scopes, whether they
    // are granted, the connector version and the provider's connectivity `details`. An authenticated MC
    // operator holding NO connector permission must not read it: every other JWT route is default-deny.
    test('GET status WITHOUT the manage permission → 403; the health is never composed', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/status',
        headers: { authorization: bearerWithPermissions([]) },
      });

      expect(res.statusCode).toBe(403);
      expect(provider.introspection.statusChecks).not.toHaveBeenCalled();
      expect(ports.configResolver.resolve).not.toHaveBeenCalled();
      await app.close();
    });

    test('GET status WITH the manage permission → 200 and the composed health payload is unchanged', async () => {
      const app = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/operations/status', headers: manageHeaders });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.status).toBe('string');
      expect(Array.isArray(body.checks)).toBe(true);
      expect(provider.introspection.statusChecks).toHaveBeenCalledTimes(1);
      await app.close();
    });

    // Checkout probes the catalogue with an exchange token it mints itself - authenticated and addressed to
    // this processor, but carrying NO operator permissions. A manage gate here made Checkout report the
    // connector as broken on the "Add payment integration" screen.
    test('GET payment-components with a token carrying NO permissions (Checkout) → 200', async () => {
      provider.introspection.supportedComponents = jest
        .fn<typeof provider.introspection.supportedComponents>()
        .mockReturnValue([{ type: 'card' }]);
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-components',
        headers: { authorization: bearerWithPermissions([]) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().components).toStrictEqual([{ type: 'card' }]);
      await app.close();
    });

    test('GET payment-components still refuses a token minted for ANOTHER origin → 403; the catalog is never read', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/payment-components',
        headers: {
          authorization: bearerWithPayload({
            iss: ISSUER,
            type: 'exchange',
            aud: 'https://other-app.example/api',
            [`${ISSUER}/claims/user_permissions`]: [],
          }),
        },
      });

      expect(res.statusCode).toBe(403);
      expect(provider.introspection.supportedComponents).not.toHaveBeenCalled();
      await app.close();
    });

    test('GET payment-components WITH the manage permission → 200 with the advertised catalog unchanged', async () => {
      provider.introspection.supportedComponents = jest
        .fn<typeof provider.introspection.supportedComponents>()
        .mockReturnValue([{ type: 'card' }]);
      provider.introspection.supportedDropins = jest
        .fn<typeof provider.introspection.supportedDropins>()
        .mockReturnValue([{ type: 'hpp' }]);
      const app = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/operations/payment-components', headers: manageHeaders });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ dropins: [{ type: 'hpp' }], components: [{ type: 'card' }], express: [] });
      await app.close();
    });
  });

  // The PUT/store-config request DTO is strict (`additionalProperties: false`): unknown keys are dropped
  // at the validation boundary (Fastify's default `removeAdditional`), so a manage operator cannot smuggle
  // arbitrary keys into the persisted Custom Object — the orchestrator (and the write) only ever see the
  // declared shape. A valid full MC payload is unaffected.
  describe('store-config request strictness', () => {
    beforeEach(() => {
      storeExists.mockResolvedValue(true);
    });

    test('a valid full MC payload validates and persists', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: {
          mode: 'sandbox',
          environments: { sandbox: { host: 'https://t', webhookUrl: 'https://t/hook' }, live: {} },
          settings: {},
        },
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      expect(ports.configStore.write).toHaveBeenCalledTimes(1);
      await app.close();
    });

    test('an unknown top-level key is dropped at the boundary and never persisted', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: { mode: 'sandbox', settings: {}, bogusTopLevel: 'x' },
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      const persisted = jest.mocked(ports.configStore.write).mock.calls[0][1] as Record<string, unknown>;
      expect(persisted).not.toHaveProperty('bogusTopLevel');
      await app.close();
    });

    test('an unknown per-environment key is dropped at the boundary and never persisted', async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: '/operations/store-config',
        payload: {
          mode: 'sandbox',
          environments: { sandbox: { credentials: { publicKey: 'pk', privateKey: 'pv' }, sneaky: 'y' } },
          settings: {},
        },
        headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
      });

      expect(res.statusCode).toBe(200);
      const persisted = jest.mocked(ports.configStore.write).mock.calls[0][1] as {
        environments?: { sandbox?: Record<string, unknown> };
      };
      // `sneaky` (unknown) is dropped at the boundary; the legitimate `credentials` bag survives.
      // `host`/`webhookUrl` are no longer accepted at this boundary (Sec1) — they are stripped too.
      expect(persisted.environments?.sandbox).not.toHaveProperty('sneaky');
      expect(persisted.environments?.sandbox?.credentials).toEqual({ publicKey: 'pk', privateKey: 'pv' });
      await app.close();
    });
  });
});
