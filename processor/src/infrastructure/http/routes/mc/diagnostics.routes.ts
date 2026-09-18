import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { StatusResponseSchema, StatusResponseSchemaDTO } from '../../dtos/mc/status.dto';
import { TestConnectionResponseSchema, TestConnectionResponseSchemaDTO } from '../../dtos/mc/testconnection.dto';
import { SupportedPaymentComponentsSchema } from '../../dtos/mc/payment-components.dto';
import { getStatus, getSupportedPaymentComponents, testConnection } from '../../../../application/orchestration';
import { toSupportedComponentsWire } from '../../mappers/operation.mappers';
import { readStoreKeyHeader } from '../../authorization/store-authorization';
import { jwtGuards, type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/**
 * `mc`: connector health and the live credential probe behind the manage gate; the component advertisement
 * behind the JWT + audience guards alone, because Checkout reads it with an exchange token of its own that
 * carries no operator permissions - a manage gate there answers 403 and Checkout reports the connector broken.
 */
export const mcDiagnosticsRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  const deps = orchestrationDeps(opts);
  const { env, storeAuthorization } = opts;
  const storeScoped = [
    ...jwtGuards(opts),
    storeAuthorization.requireExistingStore,
    storeAuthorization.requireManagePermission,
  ];
  const connectorWide = [...jwtGuards(opts), storeAuthorization.requireManagePermission];
  const catalogue = jwtGuards(opts);

  fastify.get<{ Reply: StatusResponseSchemaDTO }>(
    '/status',
    {
      preHandler: connectorWide,
      schema: {
        response: {
          200: StatusResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const status = await getStatus({ env }, deps);
      reply.code(200).send(status);
    },
  );

  fastify.post<{ Reply: TestConnectionResponseSchemaDTO }>(
    '/testconnection',
    {
      preHandler: storeScoped,
      schema: {
        response: {
          200: TestConnectionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await testConnection({ env, storeKey: readStoreKeyHeader(request) }, deps);
      reply.code(200).send(result);
    },
  );

  fastify.get(
    '/payment-components',
    {
      preHandler: catalogue,
      schema: {
        response: {
          200: SupportedPaymentComponentsSchema,
        },
      },
    },
    async (_, reply) => {
      const result = await getSupportedPaymentComponents({ env }, deps);
      reply.code(200).send(toSupportedComponentsWire(result));
    },
  );
};
