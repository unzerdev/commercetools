import { ctAuthHooks } from '../../../commercetools';
import { env, ports, provider } from '../../../../composition-root';
import { FastifyInstance } from 'fastify';
import { paymentRoutes } from '../../routes/enabler/payment.route';

/** Session `POST /payments`. */
export default async function (server: FastifyInstance) {
  await server.register(paymentRoutes, {
    ports,
    provider,
    env,
    sessionHeaderAuthHook: ctAuthHooks.sessionHeader,
  });
}
