import '@fastify/request-context';
import { ContextData } from './libs/fastify/context/context';

/** Ambient augmentation of the request context and the Fastify request, applied across the compilation. */
declare module '@fastify/request-context' {
  interface RequestContextData {
    request: ContextData;
  }
}

declare module 'fastify' {
  export interface FastifyRequest {
    correlationId?: string;
  }
}
