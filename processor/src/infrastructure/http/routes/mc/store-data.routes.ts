import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  StoreReferenceDataResponseSchema,
  StoreReferenceDataResponseSchemaDTO,
} from '../../dtos/mc/store-reference-data.dto';
import { StoresResponseSchema, StoresResponseSchemaDTO } from '../../dtos/mc/stores.dto';
import { getStoreReferenceData, listStores } from '../../../../application/orchestration';
import { readStoreKeyHeader } from '../../authorization/store-authorization';
import { jwtGuards, type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `mc`: the commercetools data the config app renders its pickers from. `/stores` lists all stores, so it is manage-gated only. */
export const mcStoreDataRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  const deps = orchestrationDeps(opts);
  const { env, storeAuthorization } = opts;

  fastify.get<{ Reply: StoreReferenceDataResponseSchemaDTO }>(
    '/store-reference-data',
    {
      preHandler: [
        ...jwtGuards(opts),
        storeAuthorization.requireExistingStore,
        storeAuthorization.requireManagePermission,
      ],
      schema: {
        response: {
          200: StoreReferenceDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const referenceData = await getStoreReferenceData({ env, storeKey: readStoreKeyHeader(request) }, deps);
      reply.code(200).send(referenceData);
    },
  );

  fastify.get<{ Reply: StoresResponseSchemaDTO }>(
    '/stores',
    {
      preHandler: [...jwtGuards(opts), storeAuthorization.requireManagePermission],
      schema: {
        response: {
          200: StoresResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const stores = await listStores({ env }, deps);
      reply.code(200).send(stores);
    },
  );
};
