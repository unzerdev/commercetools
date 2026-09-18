import { provider } from '../../../../composition-root';
import { FastifyInstance } from 'fastify';
import { methodLogoRoutes } from '../../routes/public/method-logo.route';

/** Public `GET /assets/method-logo/:code`, no auth hook and no prefix. */
export default async function (server: FastifyInstance) {
  await server.register(methodLogoRoutes, { provider });
}
