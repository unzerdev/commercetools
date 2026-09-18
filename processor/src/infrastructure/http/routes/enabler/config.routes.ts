import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PaymentConfigResponseSchema, PaymentConfigResponseSchemaDTO } from '../../dtos/enabler/payment-config.dto';
import { getPaymentConfig } from '../../../../application/orchestration';
import { type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `enabler`: the shopper-facing payment config, session-authed. */
export const enablerConfigRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  const deps = orchestrationDeps(opts);
  const { env } = opts;

  fastify.get<{ Reply: PaymentConfigResponseSchemaDTO }>(
    '/payment-config',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PaymentConfigResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const config = await getPaymentConfig({ env }, deps);
      reply.code(200).send(config);
    },
  );
};
