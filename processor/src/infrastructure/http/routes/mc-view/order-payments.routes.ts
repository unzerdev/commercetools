import { Type } from '@sinclair/typebox';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PaymentIntentRequestSchema,
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentIntentResponseSchemaDTO,
} from '../../dtos/shared/payment-intents.dto';
import { OrderPaymentsResponseSchema, OrderPaymentsResponseSchemaDTO } from '../../dtos/mc-view/order-payments.dto';
import { applyMerchantIntent, getOrderPayments } from '../../../../application/orchestration';
import { toOrderPaymentsWire, toPaymentIntentWire } from '../../mappers/operation.mappers';
import { jwtGuards, type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `mc-view`: the panel read and its intent channel. Neither takes a store key; both derive it from the resource. */
export const mcViewOrderPaymentsRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  const deps = orchestrationDeps(opts);
  const { env, storeAuthorization } = opts;
  const guards = [...jwtGuards(opts), storeAuthorization.requireManagePermission];

  fastify.get<{ Params: { orderId: string }; Reply: OrderPaymentsResponseSchemaDTO }>(
    '/orders/:orderId/payments',
    {
      preHandler: guards,
      schema: {
        params: Type.Object({ orderId: Type.String() }),
        response: {
          200: OrderPaymentsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const view = await getOrderPayments({ env, orderId: request.params.orderId }, deps);
      reply.code(200).send(toOrderPaymentsWire(view));
    },
  );

  fastify.post<{ Body: PaymentIntentRequestSchemaDTO; Reply: PaymentIntentResponseSchemaDTO; Params: { id: string } }>(
    '/payments/:id/intents',
    {
      preHandler: guards,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: PaymentIntentRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await applyMerchantIntent({ env, paymentId: request.params.id, data: request.body }, deps);

      return reply.status(200).send(toPaymentIntentWire(resp));
    },
  );
};
