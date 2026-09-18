import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PaymentMethodsQuerySchema,
  PaymentMethodsQuerySchemaDTO,
  PaymentMethodsRequestSchema,
  PaymentMethodsRequestSchemaDTO,
  PaymentMethodsResponseSchema,
  PaymentMethodsResponseSchemaDTO,
  PaymentMethodsViewResponseSchema,
  PaymentMethodsViewResponseSchemaDTO,
} from '../../dtos/mc/payment-methods.dto';
import { getPaymentMethods, updatePaymentMethods } from '../../../../application/orchestration';
import { readStoreKeyHeader } from '../../authorization/store-authorization';
import { jwtGuards, type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `mc`: the per-store payment-methods configuration, store-scoped like store-config. */
export const mcPaymentMethodsRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  const deps = orchestrationDeps(opts);
  const { env, storeAuthorization } = opts;
  const guards = [
    ...jwtGuards(opts),
    storeAuthorization.requireExistingStore,
    storeAuthorization.requireManagePermission,
  ];

  fastify.get<{ Querystring: PaymentMethodsQuerySchemaDTO; Reply: PaymentMethodsViewResponseSchemaDTO }>(
    '/payment-methods',
    {
      preHandler: guards,
      schema: {
        querystring: PaymentMethodsQuerySchema,
        response: {
          200: PaymentMethodsViewResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const methods = await getPaymentMethods(
        { env, storeKey: readStoreKeyHeader(request), mode: request.query.mode },
        deps,
      );
      reply.code(200).send(methods);
    },
  );

  fastify.put<{
    Querystring: PaymentMethodsQuerySchemaDTO;
    Body: PaymentMethodsRequestSchemaDTO;
    Reply: PaymentMethodsResponseSchemaDTO;
  }>(
    '/payment-methods',
    {
      preHandler: guards,
      schema: {
        querystring: PaymentMethodsQuerySchema,
        body: PaymentMethodsRequestSchema,
        response: {
          200: PaymentMethodsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const methods = await updatePaymentMethods(
        { env, body: request.body, storeKey: readStoreKeyHeader(request), mode: request.query.mode },
        deps,
      );
      reply.code(200).send(methods);
    },
  );
};
