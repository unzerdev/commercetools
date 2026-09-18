import { env, ports, provider } from '../../../../composition-root';
import { FastifyInstance } from 'fastify';
import { returnRoutes } from '../../routes/public/return.route';

/** Public `GET /return`, no auth hook and no prefix. */
export default async function (server: FastifyInstance) {
  await server.register(returnRoutes, { ports, provider, env });
}
