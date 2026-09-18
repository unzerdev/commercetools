import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { CorePorts } from '../../../application/ports';
import type { ProviderModule } from '../../../application/handlers';
import type { OrchestrationEnv } from '../../../application/orchestration';
import type { StoreAuthorization } from '../authorization/store-authorization';

/** What every `/operations/*` group receives from the plugin that mounts the prefix. */
export type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
  storeAuthorization: StoreAuthorization;
  ports: CorePorts;
  provider: ProviderModule;
  env: OrchestrationEnv;
};

export type OperationRouteGroup = (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => Promise<void>;

/** The guard chain every Merchant Center route runs: the SDK's JWT check plus the audience gate it lacks. */
export const jwtGuards = (opts: OperationRouteOptions) => [
  opts.jwtAuthHook.authenticate(),
  opts.storeAuthorization.requireMatchingAudience,
];

export const orchestrationDeps = (opts: OperationRouteOptions) => ({ ports: opts.ports, provider: opts.provider });
