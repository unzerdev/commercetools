import { FastifyInstance } from 'fastify';
import packageJSON from '../../../../../package.json';
import { healthRoutes } from '../../routes/public/health.route';

/** Public `GET /health`, no auth hook and no prefix. */
export default async function (server: FastifyInstance) {
  await server.register(healthRoutes, { name: packageJSON.name, version: packageJSON.version });
}
