/**
 * `GET /operations/stores` route authorization.
 *
 * This route lists ALL project stores, so it is NOT per-store: it is gated by the connector-level manage
 * permission ONLY, with NO `requireExistingStore` check (there is no single X-Store-Key to authorize).
 * These specs drive the REAL route + REAL `createStoreAuthorization` with a crafted (unsigned,
 * already-"validated") Bearer JWT carrying the operator's `<iss>/claims/user_permissions` claim,
 * asserting that a request
 * without the manage permission is refused before any read, and that an authorized request returns the
 * list WITHOUT ever probing store existence.
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
const bearerWithPermissions = (permissions: string[]): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      type: 'exchange',
      aud: FORWARD_TO_AUDIENCE,
      [`${ISSUER}/claims/user_permissions`]: permissions,
    }),
  ).toString('base64url');
  return `Bearer ${header}.${payload}.`;
};

describe('operations stores route — connector-level authorization', () => {
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
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(false);
  });

  test('a request WITHOUT the manage permission → 403; no store list is read', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/stores',
      headers: { authorization: bearerWithPermissions(['canViewPspPayments']) },
    });

    expect(res.statusCode).toBe(403);
    expect(ports.projectStoreReader.listStores).not.toHaveBeenCalled();
    await app.close();
  });

  test('a request WITH the manage permission → 200 and returns the list, never probing store existence', async () => {
    ports.projectStoreReader.listStores = jest.fn<typeof ports.projectStoreReader.listStores>().mockResolvedValue([
      { key: 'store-a', name: 'Store A' },
      { key: 'store-b', name: 'Store B' },
    ]);
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/stores',
      headers: { authorization: bearerWithPermissions([MANAGE_PERMISSION]) },
    });

    expect(res.statusCode).toBe(200);
    // The default scope leads the list; the project stores follow.
    expect(res.json()).toEqual([
      { key: '__default__', name: 'Default', isDefault: true },
      { key: 'store-a', name: 'Store A' },
      { key: 'store-b', name: 'Store B' },
    ]);
    expect(ports.projectStoreReader.listStores).toHaveBeenCalledTimes(1);
    // The list is not per-store, so the store-existence probe must never run for this route.
    expect(storeExists).not.toHaveBeenCalled();
    await app.close();
  });
});
