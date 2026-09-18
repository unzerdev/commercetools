import autoLoad from '@fastify/autoload';
import cors from '@fastify/cors';
import fastifyFormBody from '@fastify/formbody';
import { config } from '../../config/config';
import { errorHandler } from '../../bootstrap/libs/fastify/error-handler';
import { redactWebhookToken } from '../../../domain';
import { requestContextPlugin } from '../../bootstrap/libs/fastify/context/context';
import Fastify, { type FastifyInstance, type FastifyRequest, LogController } from 'fastify';
import { randomUUID } from 'node:crypto';
import { join } from 'path';

/** An `application/json` parser that keeps the untouched bytes on `request.rawBody` for the webhook route. */
export const registerRawBodyParser = (server: FastifyInstance): void => {
  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body: Buffer, done) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
    try {
      const parsed = body.length ? JSON.parse(body.toString('utf8')) : undefined;
      if (parsed === undefined) {
        done(
          Object.assign(new SyntaxError("Body cannot be empty when content-type is set to 'application/json'"), {
            statusCode: 400,
          }),
          undefined,
        );
        return;
      }
      done(null, parsed);
    } catch (error) {
      done(Object.assign(error as Error, { statusCode: 400 }), undefined);
    }
  });
};

/** Fastify's default request serializer with the webhook token redacted from the logged URL. */
export const requestLogSerializers = {
  req: (request: FastifyRequest) => {
    const acceptVersion = request.headers?.['accept-version'];
    return {
      method: request.method,
      url: redactWebhookToken(request.url),
      version: Array.isArray(acceptVersion) ? acceptVersion[0] : acceptVersion,
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket?.remotePort,
    };
  },
};

/** The Fastify server: redacting logger, CoCo error handler, a 404 that never echoes the URL, CORS, raw body, plugins. */
export const setupFastify = async () => {
  const server = Fastify({
    logger: {
      level: config.loggerLevel,
      serializers: requestLogSerializers,
    },
    genReqId: () => randomUUID().toString(),
    // The request-id log label moved onto the log controller in fastify 5; the top-level
    // `requestIdLogLabel` still works but warns (FSTDEP024) and is removed in fastify 6.
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    requestIdHeader: 'x-request-id',
  });

  server.setErrorHandler(errorHandler);

  server.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ message: `Route ${request.method} not found`, statusCode: 404 }),
  );

  await server.register(cors, {
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID', 'X-Session-ID'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    origin: '*',
  });

  await server.register(fastifyFormBody);

  registerRawBodyParser(server);

  await server.register(requestContextPlugin);

  await server.register(autoLoad, {
    dir: join(__dirname, 'plugins'),
  });

  return server;
};
