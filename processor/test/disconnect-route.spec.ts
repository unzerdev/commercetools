/**
 * The `DELETE /operations/store-config` route and its authorization.
 *
 * Drives the REAL route + `createStoreAuthorization` through Fastify with a mocked store-existence checker
 * and a crafted (unsigned, already-"validated") Bearer JWT carrying the operator's permissions under
 * the issuer-namespaced `<iss>/claims/user_permissions` claim of the forward-to exchange token.
 * Asserts the disconnect carries BOTH authz preHandlers (an unknown/foreign store or a missing manage
 * permission is refused before any persistence mutation) and that a permitted request reaches the
 * orchestration with the header store key + querystring mode.
 */
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

const passHook = { authenticate: () => async () => {} };
const authorizeHook = { authorize: () => async () => {} };

const DEFAULT_STORE_KEY = 'store-1';
const MANAGE_PERMISSION = 'canManagePspPayments';

const ISSUER = 'https://mc-api.europe-west1.gcp.commercetools.com';

/** A crafted Bearer token carrying the given MC permissions under the issuer-namespaced
 * `<iss>/claims/user_permissions` claim and the `aud` the gateway stamps, mirroring the documented
 * forward-to exchange token. */
const bearerWithPermissions = (permissions: string[] | undefined): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const claims =
    permissions === undefined
      ? { iss: ISSUER, type: 'exchange', aud: FORWARD_TO_AUDIENCE }
      : {
          iss: ISSUER,
          type: 'exchange',
          aud: FORWARD_TO_AUDIENCE,
          [`${ISSUER}/claims/user_permissions`]: permissions,
        };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `Bearer ${header}.${payload}.`;
};

describe('DELETE /operations/store-config — disconnect', () => {
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

  const manageHeaders = { authorization: bearerWithPermissions([MANAGE_PERMISSION]) };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(false);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: true, version: 2 });
  });

  test('a FOREIGN/unknown X-Store-Key → 403; nothing is cleared or deleted (IDOR)', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/operations/store-config?mode=sandbox',
      headers: { 'X-Store-Key': 'ghost-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(403);
    expect(storeExists).toHaveBeenCalledWith('ghost-store');
    expect(ports.configStore.clearEnvCredentials).not.toHaveBeenCalled();
    expect(ports.configStore.delete).not.toHaveBeenCalled();
    await app.close();
  });

  test('WITHOUT the manage permission → 403; nothing is cleared or deleted', async () => {
    storeExists.mockResolvedValue(true);
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/operations/store-config?mode=sandbox',
      headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions(['canViewPspPayments']) },
    });

    expect(res.statusCode).toBe(403);
    expect(ports.configStore.clearEnvCredentials).not.toHaveBeenCalled();
    expect(ports.configStore.delete).not.toHaveBeenCalled();
    await app.close();
  });

  test('a permitted disconnect → 200, clearing the header store key at the querystring mode', async () => {
    storeExists.mockResolvedValue(true);
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/operations/store-config?mode=live',
      headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(200);
    expect(ports.configStore.clearEnvCredentials).toHaveBeenCalledWith('real-store', 'live');
    await app.close();
  });

  test('when the last env is cleared it deletes the whole CO with the post-rewrite version', async () => {
    storeExists.mockResolvedValue(true);
    ports.configStore.clearEnvCredentials = jest
      .fn<typeof ports.configStore.clearEnvCredentials>()
      .mockResolvedValue({ remainingCredentials: false, version: 11 });
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/operations/store-config?mode=sandbox',
      headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(200);
    expect(ports.configStore.delete).toHaveBeenCalledWith('real-store', 11);
    await app.close();
  });
});
