import { env, ports, provider } from '../../../../composition-root';
import { FastifyInstance } from 'fastify';
import { webhookRoutes } from '../../routes/vendor/webhook.route';

/** Public `POST /webhooks/:storeKey/:token`, no auth hook and no prefix. */
export default async function (server: FastifyInstance) {
  await server.register(webhookRoutes, { ports, provider, env });
}
