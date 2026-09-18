import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { type HealthResponseDTO, HealthResponseSchema } from '../../dtos/public/health.dto';

export interface HealthRoutesOptions {
  name: string;
  version: string;
}

/**
 * Public `GET /health`: answers the moment the boot guards have passed and the server listens, with the
 * package name and version so a deployment can be told apart from the one before it. Deliberately no
 * I/O and no configuration in the body - downstream state is `/operations/status`, behind the MC JWT.
 */
export const healthRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & HealthRoutesOptions) => {
  fastify.get<{ Reply: HealthResponseDTO }>(
    '/health',
    { schema: { response: { 200: HealthResponseSchema } } },
    async (_request, reply) =>
      reply.header('Cache-Control', 'no-store').send({ status: 'ok', name: opts.name, version: opts.version }),
  );
};
