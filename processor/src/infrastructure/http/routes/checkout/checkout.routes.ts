import { Type } from '@sinclair/typebox';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PaymentIntentRequestSchema,
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentIntentResponseSchemaDTO,
} from '../../dtos/shared/payment-intents.dto';
import { modifyPayment } from '../../../../application/orchestration';
import { toPaymentIntentWire } from '../../mappers/operation.mappers';
import { type OperationRouteOptions, orchestrationDeps } from '../operation-context';

/** `checkout`: commercetools Checkout server to server, OAuth2 plus scope authorization, never the MC JWT. */
export const checkoutRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & OperationRouteOptions) => {
  const deps = orchestrationDeps(opts);
  const { env } = opts;

  fastify.post<{ Body: PaymentIntentRequestSchemaDTO; Reply: PaymentIntentResponseSchemaDTO; Params: { id: string } }>(
    '/payment-intents/:id',
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize('manage_project', 'manage_checkout_payment_intents'),
      ],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            id: Type.String(),
          },
          required: ['id'],
        },
        body: PaymentIntentRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const resp = await modifyPayment(
        { env, paymentId: id, storeKey: opts.ports.configResolver.storeKey(), data: request.body },
        deps,
      );

      return reply.status(200).send(toPaymentIntentWire(resp));
    },
  );
};
