import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PaymentRequestSchema,
  PaymentRequestSchemaDTO,
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
} from '../../dtos/enabler/payment.dto';
import type { CorePorts } from '../../../../application/ports';
import type { ProviderModule } from '../../../../application/handlers';
import { createPayment, type OrchestrationEnv } from '../../../../application/orchestration';
import { getCheckoutTransactionItemIdFromContext } from '../../../bootstrap/libs/fastify/context/context';

type PaymentRoutesOptions = {
  ports: CorePorts;
  provider: ProviderModule;
  env: OrchestrationEnv;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

/** Session `POST /payments`, thin over `createPayment`. */
export const paymentRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRoutesOptions) => {
  const deps = { ports: opts.ports, provider: opts.provider };

  fastify.post<{ Body: PaymentRequestSchemaDTO; Reply: PaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: PaymentRequestSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const checkoutTransactionItemId = getCheckoutTransactionItemIdFromContext();
      const resp = await createPayment(
        {
          env: opts.env,
          data: request.body,
          ...(checkoutTransactionItemId ? { checkoutTransactionItemId } : {}),
        },
        deps,
      );

      return reply.status(200).send(resp);
    },
  );
};
