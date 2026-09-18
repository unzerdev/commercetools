import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { checkoutRoutes } from './checkout/checkout.routes';
import { enablerConfigRoutes } from './enabler/config.routes';
import { mcDiagnosticsRoutes } from './mc/diagnostics.routes';
import { mcPaymentMethodsRoutes } from './mc/payment-methods.routes';
import { mcStoreConfigRoutes } from './mc/store-config.routes';
import { mcStoreDataRoutes } from './mc/store-data.routes';
import { mcViewOrderPaymentsRoutes } from './mc-view/order-payments.routes';
import type { OperationRouteOptions } from './operation-context';

export type { OperationRouteOptions } from './operation-context';

/** The `/operations/*` composer: one group per consuming application; the prefix stays with the parent context. */
export const operationsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & OperationRouteOptions) => {
  const { prefix: _prefix, ...groupOpts } = opts;
  void _prefix;

  await fastify.register(enablerConfigRoutes, groupOpts);

  await fastify.register(mcStoreConfigRoutes, groupOpts);
  await fastify.register(mcPaymentMethodsRoutes, groupOpts);
  await fastify.register(mcStoreDataRoutes, groupOpts);
  await fastify.register(mcDiagnosticsRoutes, groupOpts);

  await fastify.register(mcViewOrderPaymentsRoutes, groupOpts);

  await fastify.register(checkoutRoutes, groupOpts);
};
