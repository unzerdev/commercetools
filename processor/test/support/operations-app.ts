/**
 * The Fastify app the merchant `/operations/*` specs drive, and the Merchant Center token that reaches it.
 *
 * The routes are registered for real - the REAL `createStoreAuthorization` included - with only the SDK
 * auth hooks stubbed: their signature/issuer validation is the SDK's concern, while the authorization
 * LAYER (store existence, the manage-permission gate) is exactly what these specs are about.
 *
 * The Bearer token is crafted, unsigned and already-"validated": it mirrors the forward-to exchange
 * token the MC API Gateway mints, carrying the operator's permissions under the issuer-namespaced
 * `<iss>/claims/user_permissions` claim and the `aud` the gateway stamps with the forward-to URL.
 */
import { requestContextPlugin } from '../../src/infrastructure/bootstrap/libs/fastify/context/context';
import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorAuthErrorResponse } from '@commercetools/connect-payments-sdk';
import type { CorePorts } from '../../src/application/ports';
import type { ProviderModule } from '../../src/application/handlers';
import type { OrchestrationEnv } from '../../src/application/orchestration';
import { errorHandler } from '../../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { operationsRoute } from '../../src/infrastructure/http/routes/operation.route';
import {
  createStoreAuthorization,
  type StoreAuthorizationDeps,
} from '../../src/infrastructure/http/authorization/store-authorization';
import { makeFakeEnv } from './fake-provider-module';

/** An auth hook that lets every request through - the stub for the SDK hooks under test. */
export const passHook = { authenticate: () => async () => {} };
export const authorizeHook = { authorize: () => async () => {} };

/** A JWT hook that rejects, as the SDK's does for an absent/invalid token. */
export const failJwtHook = {
  authenticate: () => async () => {
    throw new ErrorAuthErrorResponse('Unauthorized.', undefined, 'Unauthorized');
  },
};

export const DEPLOYMENT_STORE_KEY = 'store-1';
export const MANAGE_PERMISSION = 'canManagePspPayments';
export const ISSUER = 'https://mc-api.europe-west1.gcp.commercetools.com';

/** The processor's own public base URL under test; the audience gate accepts only tokens minted for it. */
export const PUBLIC_URL = 'https://processor.example.com';
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;

/** The `aud` the MC API Gateway stamps by default (`forward-url-full-path`): the forward-to URL itself. */
export const FORWARD_TO_AUDIENCE = `${PUBLIC_URL}/operations/store-config`;

/** A Bearer exchange token over an arbitrary claim set - for the malformed/hostile token shapes. */
export function bearerWithClaims(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `Bearer ${header}.${payload}.`;
}

/**
 * A Bearer exchange token carrying the given MC permissions; `undefined` omits the claim entirely.
 * It carries the gateway's `aud` by default, so a spec that is not about the audience gate passes it.
 */
export function bearerWithPermissions(permissions: string[] | undefined, aud: unknown = FORWARD_TO_AUDIENCE): string {
  return bearerWithClaims(
    permissions === undefined
      ? { iss: ISSUER, type: 'exchange', aud }
      : { iss: ISSUER, type: 'exchange', aud, [`${ISSUER}/claims/user_permissions`]: permissions },
  );
}

/** The headers of an operator who holds the connector's manage permission. */
export const manageHeaders = { authorization: bearerWithPermissions([MANAGE_PERMISSION]) };

export interface OperationsAppOptions {
  ports: CorePorts;
  provider: ProviderModule;
  /** Whether the store named by `X-Store-Key` exists - the store-authorization probe. */
  storeExists: StoreAuthorizationDeps['storeChecker']['storeExists'];
  env?: OrchestrationEnv;
  /** Defaults to a hook that lets every request through; pass {@link failJwtHook} for the 401 cases. */
  jwtAuthHook?: unknown;
  /** The origin the audience gate compares against; defaults to the fixed {@link PUBLIC_ORIGIN}. */
  publicOrigin?: StoreAuthorizationDeps['publicOrigin'];
  /** Register the request-context plugin first, for a resolver that reads the request's derived origin. */
  withRequestContext?: boolean;
}

/** Register the merchant `/operations/*` routes on a fresh Fastify instance, ready to `inject`. */
export async function buildOperationsApp(opts: OperationsAppOptions): Promise<FastifyInstance> {
  const fastify = Fastify();
  fastify.setErrorHandler(errorHandler);
  if (opts.withRequestContext) {
    await fastify.register(requestContextPlugin);
  }
  await fastify.register(operationsRoute, {
    prefix: '/operations',
    ports: opts.ports,
    provider: opts.provider,
    env: opts.env ?? makeFakeEnv(),
    jwtAuthHook: (opts.jwtAuthHook ?? passHook) as never,
    oauth2AuthHook: passHook as never,
    sessionHeaderAuthHook: passHook as never,
    authorizationHook: authorizeHook as never,
    storeAuthorization: createStoreAuthorization({
      storeChecker: { storeExists: opts.storeExists },
      defaultStoreKey: () => DEPLOYMENT_STORE_KEY,
      managePermission: MANAGE_PERMISSION,
      publicOrigin: opts.publicOrigin ?? (() => PUBLIC_ORIGIN),
      logger: { warn: () => {} },
    }),
  });
  await fastify.ready();
  return fastify;
}
