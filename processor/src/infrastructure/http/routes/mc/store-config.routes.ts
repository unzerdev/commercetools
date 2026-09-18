import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  StoreConfigRequestSchema,
  StoreConfigRequestSchemaDTO,
  StoreConfigResponseSchema,
  StoreConfigResponseSchemaDTO,
} from '../../dtos/mc/store-config.dto';
import { DisconnectStoreConfigQuerySchema, DisconnectStoreConfigQuerySchemaDTO } from '../../dtos/mc/disconnect.dto';
import { disconnectStoreConfig, getStoreConfig, updateStoreConfig } from '../../../../application/orchestration';
import { readStoreKeyHeader } from '../../authorization/store-authorization';
import { jwtGuards, type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `mc`: the per-store connection surface. The GET returns the live key pair, so the manage gate is on the read too. */
export const mcStoreConfigRoutes = async (
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

  fastify.get<{ Reply: StoreConfigResponseSchemaDTO }>(
    '/store-config',
    {
      preHandler: guards,
      schema: {
        response: {
          200: StoreConfigResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const config = await getStoreConfig({ env, storeKey: readStoreKeyHeader(request) }, deps);
      reply.code(200).send(config);
    },
  );

  fastify.put<{ Body: StoreConfigRequestSchemaDTO; Reply: StoreConfigResponseSchemaDTO }>(
    '/store-config',
    {
      preHandler: guards,
      schema: {
        body: StoreConfigRequestSchema,
        response: {
          200: StoreConfigResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const config = await updateStoreConfig({ env, body: request.body, storeKey: readStoreKeyHeader(request) }, deps);
      reply.code(200).send(config);
    },
  );

  fastify.delete<{ Querystring: DisconnectStoreConfigQuerySchemaDTO }>(
    '/store-config',
    {
      preHandler: guards,
      schema: {
        querystring: DisconnectStoreConfigQuerySchema,
      },
    },
    async (request, reply) => {
      await disconnectStoreConfig({ env, storeKey: readStoreKeyHeader(request), mode: request.query.mode }, deps);
      reply.code(200).send();
    },
  );
};
