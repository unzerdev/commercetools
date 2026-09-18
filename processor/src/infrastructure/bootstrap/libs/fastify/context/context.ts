import * as paymentSdk from '@commercetools/connect-payments-sdk';
import { fastifyRequestContext, requestContext } from '@fastify/request-context';
import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { originFromHost } from '../../../../http/origin-from-host';

/** What the request context carries for the SDK hooks and the logger. */
export type ContextData = {
  anonymousId?: string;
  customerId?: string;
  path?: string;
  pathTemplate?: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  correlationId: string;
  requestId: string;
  authentication?: paymentSdk.Authentication;
  /** This processor's origin as the request's Host names it. */
  publicOrigin?: string;
};

export const getRequestContext = (): Partial<ContextData> => {
  return requestContext.get('request') ?? {};
};

export const setRequestContext = (ctx: ContextData) => {
  requestContext.set('request', ctx);
};

export const updateRequestContext = (ctx: Partial<ContextData>) => {
  const currentContext = getRequestContext();
  setRequestContext({
    ...(currentContext as ContextData),
    ...ctx,
  });
};

export const getCartIdFromContext = (): string => {
  const contextData = getRequestContext() as ContextData;
  return paymentSdk.getCartIdFromContext(contextData) as string;
};

export const getCheckoutTransactionItemIdFromContext = (): string | undefined => {
  const contextData = getRequestContext() as ContextData;
  return paymentSdk.getCheckoutTransactionItemIdFromContext(contextData);
};

/** Registers the request context with a correlation id taken from the header or minted. */
export const requestContextPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', (req, reply, done) => {
    req.correlationId = req.headers['x-correlation-id'] ? (req.headers['x-correlation-id'] as string) : undefined;
    done();
  });

  await fastify.register(fastifyRequestContext, {
    defaultStoreValues: (req: FastifyRequest) => ({
      request: {
        path: req.url,
        pathTemplate: req.routeOptions.url,
        pathParams: req.params as Record<string, unknown>,
        query: req.query as Record<string, unknown>,
        correlationId: req.correlationId || randomUUID().toString(),
        requestId: req.id,
        publicOrigin: originFromHost(req.headers.host),
      },
    }),
    hook: 'onRequest',
  });
});
