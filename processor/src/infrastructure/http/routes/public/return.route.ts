import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ReturnQueryDTO, ReturnQuerySchema } from '../../dtos/public/return.dto';
import type { CorePorts } from '../../../../application/ports';
import type { ProviderModule } from '../../../../application/handlers';
import { type OrchestrationEnv, reflectReturn } from '../../../../application/orchestration';

type ReturnRoutesOptions = {
  ports: CorePorts;
  provider: ProviderModule;
  env: OrchestrationEnv;
};

/** Public `GET /return`: authenticity is the provider's fail-closed check inside `reflectReturn`; answers a 302. */
export const returnRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & ReturnRoutesOptions) => {
  const deps = { ports: opts.ports, provider: opts.provider };

  fastify.get<{ Querystring: ReturnQueryDTO }>(
    '/return',
    {
      schema: {
        querystring: ReturnQuerySchema,
      },
    },
    async (request, reply) => {
      const { redirectUrl } = await reflectReturn({ env: opts.env, query: request.query }, deps);
      return reply.redirect(redirectUrl, 302);
    },
  );
};
