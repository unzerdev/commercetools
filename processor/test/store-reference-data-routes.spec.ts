/**
 * `GET /operations/store-reference-data` route authorization.
 *
 * The client-controlled `X-Store-Key` is authorized ONLY by the route's `requireExistingStore` +
 * `requireManagePermission` preHandlers (ASVS/IDOR). These specs drive the REAL route + REAL
 * `createStoreAuthorization` with a mocked store-existence checker and a crafted (unsigned,
 * already-"validated") Bearer JWT carrying the operator's `<iss>/claims/user_permissions` claim,
 * asserting that a foreign
 * or unmanageable store is refused BEFORE any reference read runs, and that an authorized request
 * returns the resolved reference data.
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

describe('operations reference-data route — store-level authorization', () => {
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

  const manageHeaders = { authorization: bearerWithPermissions([MANAGE_PERMISSION]) };

  test('an unknown (foreign) X-Store-Key → 403; no reference read runs', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-reference-data',
      headers: { 'X-Store-Key': 'ghost-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(403);
    expect(storeExists).toHaveBeenCalledWith('ghost-store');
    expect(ports.projectStoreReader.readStore).not.toHaveBeenCalled();
    expect(ports.projectStoreReader.readProjectSettings).not.toHaveBeenCalled();
    await app.close();
  });

  test('a real store WITHOUT the manage permission → 403; no reference read runs', async () => {
    storeExists.mockResolvedValue(true);
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-reference-data',
      headers: { 'X-Store-Key': 'real-store', authorization: bearerWithPermissions(['canViewPspPayments']) },
    });

    expect(res.statusCode).toBe(403);
    expect(ports.projectStoreReader.readStore).not.toHaveBeenCalled();
    await app.close();
  });

  test('a lookup FAILURE fails closed → 403', async () => {
    storeExists.mockRejectedValue(new Error('commercetools unreachable'));
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-reference-data',
      headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('a known store WITH the manage permission → 200 and returns the resolved reference data', async () => {
    storeExists.mockResolvedValue(true);
    ports.projectStoreReader.readStore = jest
      .fn<typeof ports.projectStoreReader.readStore>()
      .mockResolvedValue({ languages: ['en', 'nl'], countries: ['NL'] });
    ports.projectStoreReader.readProjectSettings = jest
      .fn<typeof ports.projectStoreReader.readProjectSettings>()
      .mockResolvedValue({ languages: ['en', 'de'], currencies: ['EUR', 'USD'], countries: ['NL', 'DE'] });
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-reference-data',
      headers: { 'X-Store-Key': 'real-store', ...manageHeaders },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ languages: ['en', 'nl'], countries: ['NL'], currencies: ['EUR', 'USD'] });
    expect(ports.projectStoreReader.readStore).toHaveBeenCalledWith('real-store');
    await app.close();
  });
});
