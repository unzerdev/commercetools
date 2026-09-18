import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { CorePorts } from '../../../../application/ports';
import type { ProviderModule } from '../../../../application/handlers';
import { handleWebhook, type OrchestrationEnv } from '../../../../application/orchestration';

type WebhookRoutesOptions = {
  ports: CorePorts;
  provider: ProviderModule;
  env: OrchestrationEnv;
};

/** Stash the vendor's exact bytes for any content type, scoped to this route by Fastify encapsulation. */
export const registerWebhookRawBodyParser = (fastify: FastifyInstance): void => {
  const stashBytes = (request: FastifyRequest, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
    done(null, body);
  };

  fastify.addContentTypeParser('text/plain', { parseAs: 'buffer' }, stashBytes);
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, stashBytes);
};

/**
 * Public `POST /webhooks/:storeKey/:token`: authenticity is the capability token gate inside `handleWebhook`.
 * `unauthorized` answers 401, every other outcome 200; a processing failure throws so the vendor redelivers.
 */
export const webhookRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & WebhookRoutesOptions) => {
  const deps = { ports: opts.ports, provider: opts.provider };

  registerWebhookRawBodyParser(fastify);

  fastify.post<{ Params: { storeKey: string; token: string } }>(
    '/webhooks/:storeKey/:token',
    async (request, reply) => {
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const { outcome } = await handleWebhook(
        { env: opts.env, storeKey: request.params.storeKey, token: request.params.token, rawBody },
        deps,
      );
      return reply.code(outcome === 'unauthorized' ? 401 : 200).send({ outcome });
    },
  );
};
