import { describe, expect, jest, test } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createStoreAuthorization } from '../src/infrastructure/http/authorization/store-authorization';

/**
 * WHICH gate rejected — the server-side half of the 403.
 *
 * The three `/operations` gates answer with ONE message on purpose: a fail-closed rejection must not
 * tell a caller which control it tripped, or the message becomes a probe for the control it names. The
 * cost is borne by the operator instead — `mc` working while `mc-view` answers 403 is indistinguishable
 * from a wrong audience or an unknown store, and diagnosing it took reading the raw forward-to request
 * out of a browser. So the reason goes to the PROCESSOR's own log, where the deployment can read it and
 * a caller cannot: the gate's name plus the two values whose disagreement caused the rejection.
 *
 * What may be logged is bounded by what is not a secret. A permission identifier (`canManageX`), a store
 * key and an origin all name configuration; none of them authenticates anybody. The token itself, its
 * header and every other claim stay out — the line exists to explain a decision, not to mirror a
 * credential.
 */

const ISSUER = 'https://mc-api.europe-west1.gcp.commercetools.com';
const PUBLIC_ORIGIN = 'https://processor.example.com';
const MANAGE_PERMISSION = 'canManagePspPayments';

const bearer = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  return `Bearer ${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
};

const requestWith = (headers: Record<string, string>): FastifyRequest => ({ headers }) as FastifyRequest;

const reply = {} as FastifyReply;

const arrange = (publicOrigin: () => string | undefined = () => PUBLIC_ORIGIN) => {
  const warn = jest.fn<(message: string, meta: Record<string, unknown>) => void>();
  const authorization = createStoreAuthorization({
    storeChecker: { storeExists: async () => false },
    defaultStoreKey: () => 'store-1',
    managePermission: MANAGE_PERMISSION,
    publicOrigin,
    logger: { warn },
  });
  return { authorization, warn };
};

describe('the 403 names its gate in the processor log', () => {
  test('requireManagePermission reports the permission required and the ones the token carried', async () => {
    const { authorization, warn } = arrange();
    const token = bearer({
      iss: ISSUER,
      aud: `${PUBLIC_ORIGIN}/operations/orders/o-1/payments`,
      [`${ISSUER}/claims/user_permissions`]: ['canViewPspPayments', 'canManage'],
    });

    await expect(authorization.requireManagePermission(requestWith({ authorization: token }), reply)).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('requireManagePermission'),
      expect.objectContaining({
        gate: 'requireManagePermission',
        required: MANAGE_PERMISSION,
        presented: ['canViewPspPayments', 'canManage'],
      }),
    );
  });

  test('requireMatchingAudience reports the origin expected and the ones the token addressed', async () => {
    const { authorization, warn } = arrange();
    const token = bearer({ iss: ISSUER, aud: 'https://other-app.example.com/operations/status' });

    await expect(authorization.requireMatchingAudience(requestWith({ authorization: token }), reply)).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('requireMatchingAudience'),
      expect.objectContaining({
        gate: 'requireMatchingAudience',
        expected: PUBLIC_ORIGIN,
        presented: ['https://other-app.example.com'],
      }),
    );
  });

  test('requireMatchingAudience reports expected: null when no origin is derivable, and still refuses', async () => {
    const { authorization, warn } = arrange(() => undefined);
    const token = bearer({ iss: ISSUER, aud: PUBLIC_ORIGIN });

    await expect(authorization.requireMatchingAudience(requestWith({ authorization: token }), reply)).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('requireMatchingAudience'),
      expect.objectContaining({ gate: 'requireMatchingAudience', expected: null, presented: [PUBLIC_ORIGIN] }),
    );
  });

  test('requireExistingStore reports the store key it could not resolve', async () => {
    const { authorization, warn } = arrange();

    await expect(
      authorization.requireExistingStore(requestWith({ 'x-store-key': 'ghost-store' }), reply),
    ).rejects.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('requireExistingStore'),
      expect.objectContaining({ gate: 'requireExistingStore', storeKey: 'ghost-store' }),
    );
  });

  test('a gate that ADMITS the request logs nothing — the line marks a rejection, not traffic', async () => {
    const { authorization, warn } = arrange();
    const token = bearer({
      iss: ISSUER,
      aud: `${PUBLIC_ORIGIN}/operations/orders/o-1/payments`,
      [`${ISSUER}/claims/user_permissions`]: [MANAGE_PERMISSION],
    });
    const request = requestWith({ authorization: token });

    await authorization.requireMatchingAudience(request, reply);
    await authorization.requireManagePermission(request, reply);
    await authorization.requireExistingStore(requestWith({}), reply);

    expect(warn).not.toHaveBeenCalled();
  });

  test('the log carries no part of the bearer token itself', async () => {
    const { authorization, warn } = arrange();
    const token = bearer({ iss: ISSUER, aud: 'https://other-app.example.com/x' });

    await expect(authorization.requireMatchingAudience(requestWith({ authorization: token }), reply)).rejects.toThrow();

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(token.slice('Bearer '.length));
  });
});
