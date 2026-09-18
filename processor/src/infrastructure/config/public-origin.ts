import { getRequestContext } from '../bootstrap/libs/fastify/context/context';

/** The URL Connect assigned this deployment - handed to the post-deploy process only, never to the runtime. */
export function connectServiceUrl(): string | undefined {
  const raw = process.env.CONNECT_SERVICE_URL?.trim();
  return raw === '' ? undefined : raw;
}

function connectServiceOrigin(): string | undefined {
  const url = connectServiceUrl();
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The one answer to "what is this processor's origin": the origin the current request's Host header names,
 * else (post-deploy only, where no request exists) the one Connect assigned. The audience gate, the webhook
 * URL and the shopper return base all read it here, so they cannot disagree.
 */
export function currentPublicOrigin(): string | undefined {
  return getRequestContext().publicOrigin ?? connectServiceOrigin();
}
