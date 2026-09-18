import { Errorx } from '@commercetools/connect-payments-sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isDefaultScope } from '../../../domain';

/** The store a merchant endpoint targets, from the `X-Store-Key` header the MC proxy forwards. */
export const readStoreKeyHeader = (request: FastifyRequest): string | undefined => {
  const header = request.headers['x-store-key'];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
};

/** Where a rejection explains itself: the uniform 403 tells the caller nothing by design. */
export interface StoreAuthorizationLogger {
  warn(message: string, meta: Record<string, unknown>): void;
}

export interface StoreAuthorizationDeps {
  /** The store-existence probe; a 404 is `false`. */
  storeChecker: { storeExists(storeKey: string): Promise<boolean> };
  /** The deployment's own trusted store key. */
  defaultStoreKey: () => string;
  /** The Merchant Center permission every merchant route requires. */
  managePermission: string;
  /** This processor's own origin for the audience comparison, resolved per request; `undefined` fails the gate closed. */
  publicOrigin: () => string | undefined;
  logger: StoreAuthorizationLogger;
  /** Positive-lookup cache lifetime in ms; default 60s. */
  cacheTtlMs?: number;
  now?: () => number;
}

export type OperationPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** The three fail-closed gates the merchant `/operations/*` routes compose. */
export interface StoreAuthorization {
  requireExistingStore: OperationPreHandler;
  requireManagePermission: OperationPreHandler;
  requireMatchingAudience: OperationPreHandler;
}

const BEARER_PREFIX = 'Bearer ';

/** One message for all three gates, so a caller cannot enumerate the controls. */
const forbidden = (): Errorx =>
  new Errorx({
    code: 'Forbidden',
    message: 'Not authorized for the requested store configuration.',
    httpErrorStatus: 403,
    skipLog: true,
  });

/** The payload of the Bearer JWT the SDK hook already verified; `undefined` fails every gate closed. */
const readBearerPayload = (request: FastifyRequest): Record<string, unknown> | undefined => {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const segments = header.slice(BEARER_PREFIX.length).split('.');
  if (segments.length < 2) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** The operator's MC permissions under the issuer-namespaced `<iss>/claims/user_permissions` claim. */
const readForwardedPermissions = (payload: Record<string, unknown> | undefined): string[] => {
  if (!payload || typeof payload.iss !== 'string' || payload.iss.length === 0) {
    return [];
  }
  const permissions = payload[`${payload.iss}/claims/user_permissions`];
  return Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === 'string') : [];
};

/** The origins the token's `aud` addresses; a string or an array, unparseable entries contribute none. */
const audienceOrigins = (payload: Record<string, unknown>): string[] => {
  const raw = payload.aud;
  const candidates = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return candidates.flatMap((candidate) => {
    if (typeof candidate !== 'string') {
      return [];
    }
    try {
      return [new URL(candidate).origin];
    } catch {
      return [];
    }
  });
};

/**
 * Store-level authorization for the merchant routes: the effective store must exist (positive lookups
 * cached), the token must carry the manage permission, and its audience must be this processor's origin.
 */
export const createStoreAuthorization = (deps: StoreAuthorizationDeps): StoreAuthorization => {
  const ttl = deps.cacheTtlMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const verifiedUntil = new Map<string, number>();

  const effectiveStoreKey = (request: FastifyRequest): string => readStoreKeyHeader(request) ?? deps.defaultStoreKey();

  const requireExistingStore: OperationPreHandler = async (request) => {
    const storeKey = effectiveStoreKey(request);

    if (storeKey === deps.defaultStoreKey() || isDefaultScope(storeKey)) {
      return;
    }

    const cachedUntil = verifiedUntil.get(storeKey);
    if (cachedUntil !== undefined && cachedUntil > now()) {
      return;
    }

    let exists: boolean;
    try {
      exists = await deps.storeChecker.storeExists(storeKey);
    } catch {
      exists = false;
    }
    if (!exists) {
      deps.logger.warn('requireExistingStore rejected the request: the store key resolves to no project store.', {
        gate: 'requireExistingStore',
        storeKey,
      });
      throw forbidden();
    }
    verifiedUntil.set(storeKey, now() + ttl);
  };

  const requireManagePermission: OperationPreHandler = async (request) => {
    const presented = readForwardedPermissions(readBearerPayload(request));
    if (!presented.includes(deps.managePermission)) {
      deps.logger.warn(
        'requireManagePermission rejected the request: the exchange token does not carry the manage permission.',
        { gate: 'requireManagePermission', required: deps.managePermission, presented },
      );
      throw forbidden();
    }
  };

  const requireMatchingAudience: OperationPreHandler = async (request) => {
    const payload = readBearerPayload(request);
    const presented = payload ? audienceOrigins(payload) : [];
    const expected = deps.publicOrigin();
    if (!payload || expected === undefined || !presented.includes(expected)) {
      deps.logger.warn('requireMatchingAudience rejected the request: the token addresses another origin.', {
        gate: 'requireMatchingAudience',
        expected: expected ?? null,
        presented,
      });
      throw forbidden();
    }
  };

  return { requireExistingStore, requireManagePermission, requireMatchingAudience };
};
