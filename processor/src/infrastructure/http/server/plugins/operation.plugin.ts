import { getConfig } from '../../../config/config';
import { env, ports, provider } from '../../../../composition-root';
import { FastifyInstance } from 'fastify';
import { operationsRoute } from '../../routes/operation.route';
import { createStoreAuthorization } from '../../authorization/store-authorization';
import { ctAuthHooks } from '../../../commercetools';
import { currentPublicOrigin } from '../../../config/public-origin';
import { log } from '../../../bootstrap/libs/logger';

/** Mounts `/operations/*` with the ports, provider, env, the CT auth hooks and the store-level authorization. */
export default async function (server: FastifyInstance) {
  await server.register(operationsRoute, {
    prefix: '/operations',
    ports,
    provider,
    env,
    jwtAuthHook: ctAuthHooks.jwt,
    oauth2AuthHook: ctAuthHooks.oauth2,
    sessionHeaderAuthHook: ctAuthHooks.sessionHeader,
    authorizationHook: ctAuthHooks.authority,
    storeAuthorization: createStoreAuthorization({
      storeChecker: ports.projectStoreReader,
      defaultStoreKey: () => ports.configResolver.storeKey(),
      managePermission: getConfig().configManagePermission,
      publicOrigin: currentPublicOrigin,
      logger: { warn: (message, meta) => log.warn(message, meta) },
    }),
  });
}
