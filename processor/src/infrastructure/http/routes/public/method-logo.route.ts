import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { ProviderModule } from '../../../../application/handlers';

export interface MethodLogoRoutesOptions {
  provider: ProviderModule;
}

/**
 * Public `GET /assets/method-logo/:code`: the vendor's brand artwork, identical for every caller. The
 * code is a map lookup, never a filesystem path; the bytes are served `nosniff` under a sandbox CSP.
 */
export const methodLogoRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & MethodLogoRoutesOptions,
) => {
  fastify.get<{ Params: { code: string } }>(
    '/assets/method-logo/:code',
    {
      schema: {
        params: Type.Object({ code: Type.String() }),
      },
    },
    async (request, reply) => {
      const logo = await opts.provider.methodLogos.read(request.params.code);
      if (!logo) {
        return reply.code(404).send({ message: 'Logo not found.', statusCode: 404 });
      }

      return reply
        .header('Content-Type', logo.contentType)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Disposition', 'inline')
        .send(logo.data);
    },
  );
};
