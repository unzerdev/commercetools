/**
 * Token-audience authorization over the merchant `/operations/*` JWT routes.
 *
 * The connect-payments-SDK verifies a Merchant Center JWT's signature, issuer and expiry but passes NO
 * `audience` option to `jsonwebtoken.verify` (`security/services/jwt.service.js`), so `aud` goes
 * unchecked. Every Custom Application/View in the project can have an exchange token minted for its OWN
 * external API by the same issuer, with the same operator permissions — so without this gate a token
 * minted for a THIRD-PARTY app's API is accepted verbatim by this processor, including on the route that
 * moves money.
 *
 * These specs drive the REAL `createStoreAuthorization` through the real routes with the SDK hook stubbed
 * (its signature/issuer job is the SDK's), and pin the gate: only a token whose `aud` addresses THIS
 * processor's origin is served; everything else is a uniform 403.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { type FastifyInstance } from 'fastify';
import type { StoreAuthorizationDeps } from '../src/infrastructure/http/authorization/store-authorization';
import { fakePayment, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { bearerWithClaims, buildOperationsApp, ISSUER, MANAGE_PERMISSION, PUBLIC_URL } from './support/operations-app';
import { getRequestContext } from '../src/infrastructure/bootstrap/libs/fastify/context/context';

/** An operator token that is valid in every respect EXCEPT the audience under test. */
const tokenFor = (aud: unknown): string =>
  bearerWithClaims({
    iss: ISSUER,
    type: 'exchange',
    [`${ISSUER}/claims/user_permissions`]: [MANAGE_PERMISSION],
    ...(aud === undefined ? {} : { aud }),
  });

describe('operations JWT routes — token audience', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;

  const buildApp = (): Promise<FastifyInstance> => buildOperationsApp({ ports, provider, storeExists });

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(true);
    provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });
  });

  /**
   * The gate compares ORIGINS, not full URLs: the gateway's audience policy is configurable
   * (`forward-url-full-path` vs the app URL) and the config app's forward-to URIs carry query strings
   * (`?mode=live`, `?countryCode=NL`), so any path/query-sensitive comparison would reject real tokens.
   * The origin is what identifies the recipient.
   */
  describe.each([
    ['the exact forward-to URL', `${PUBLIC_URL}/operations/store-config`, 200],
    ['the bare origin', PUBLIC_URL, 200],
    ['the forward-to URL with a query string', `${PUBLIC_URL}/operations/store-config?mode=live`, 200],
    ['a foreign third-party API', 'https://evil-thirdparty.example/api', 403],
    ['a host that merely PREFIXES ours', 'https://processor.example.com.evil.test/api', 403],
    ['an array containing our origin (RFC 7519)', ['https://evil.example', PUBLIC_URL], 200],
    ['an array of foreign origins only', ['https://evil.example'], 403],
    ['an unparseable audience', 'not-a-url', 403],
    ['no audience at all', undefined, 403],
  ])('GET /operations/store-config with %s', (_label, aud, expected) => {
    test(`→ ${expected}`, async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/operations/store-config',
        headers: { authorization: tokenFor(aud) },
      });

      expect(res.statusCode).toBe(expected);
      await app.close();
    });
  });

  test('a rejected audience never reads the store config, and says nothing about why', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-config',
      headers: { authorization: tokenFor('https://evil-thirdparty.example/api') },
    });

    expect(res.statusCode).toBe(403);
    expect(ports.configStore.read).not.toHaveBeenCalled();
    // A foreign token is turned away before it can cost a commercetools call.
    expect(storeExists).not.toHaveBeenCalled();
    expect(res.json()).toStrictEqual(
      expect.objectContaining({ message: 'Not authorized for the requested store configuration.' }),
    );
    await app.close();
  });

  // The impact, named: this is the route that moves real money.
  test('POST /operations/payments/:id/intents with a FOREIGN audience → 403; no capture or refund is made', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(
      fakePayment({
        id: 'pay-1',
        interfaceId: 'vendor-pay-1',
        amountPlanned: { centAmount: 1500, currencyCode: 'EUR' },
        transactions: [
          { id: 't0', type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
        ],
        custom: { fields: { storeKey: 'store-b' } },
      }) as never,
    );
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/operations/payments/pay-1/intents',
      payload: { actions: [{ action: 'capturePayment', amount: { centAmount: 1500, currencyCode: 'EUR' } }] },
      headers: { authorization: tokenFor('https://evil-thirdparty.example/api') },
    });

    expect(res.statusCode).toBe(403);
    expect(provider.modifications.capture).not.toHaveBeenCalled();
    expect(provider.modifications.refund).not.toHaveBeenCalled();
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
    expect(ports.paymentStore.get).not.toHaveBeenCalled();
    await app.close();
  });

  // The gate belongs to the JWT routes ONLY. The OAuth2 (Checkout) and session-authed routes are reached
  // with tokens that carry no `aud` at all — gating them would break every certified caller.
  describe('the non-JWT routes are untouched', () => {
    test('POST /operations/payment-intents/:id (OAuth2) is served with no audience', async () => {
      ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(
        fakePayment({
          id: 'pay-1',
          interfaceId: 'vendor-pay-1',
          amountPlanned: { centAmount: 1500, currencyCode: 'EUR' },
          transactions: [],
        }) as never,
      );
      const app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/operations/payment-intents/pay-1',
        payload: { actions: [{ action: 'capturePayment', amount: { centAmount: 500, currencyCode: 'EUR' } }] },
      });

      expect(res.statusCode).toBe(200);
      await app.close();
    });

    test('GET /operations/payment-config (session) is served with no audience, exposing the public key but never the private key', async () => {
      ports.configResolver.resolveDefault = jest.fn<typeof ports.configResolver.resolveDefault>().mockResolvedValue({
        storeKey: 'store-1',
        mode: 'sandbox',
        credentials: { publicKey: 'pub-SHOPPER-SAFE', privateKey: 'priv-NEVER-LEAK' },
      } as never);
      const app = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/operations/payment-config' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expect.objectContaining({ publicKey: 'pub-SHOPPER-SAFE', environment: 'sandbox' }));
      expect(res.body).not.toContain('priv-NEVER-LEAK');
      await app.close();
    });
  });
});

/**
 * The gate compares against the origin the request's Host header names, per
 * request. Host alone: the platform ingress routes by it, so a foreign Host never reaches the process,
 * whereas `X-Forwarded-Host` is client-settable and must never widen the gate.
 */
describe('operations JWT routes - token audience derived from the request Host', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;

  const buildDerivedApp = (): Promise<FastifyInstance> =>
    buildOperationsApp({
      ports,
      provider,
      storeExists: async () => true,
      withRequestContext: true,
      publicOrigin: () => getRequestContext().publicOrigin,
    });

  const tokenForHost = tokenFor(`${PUBLIC_URL}/operations/store-config`);

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });
  });

  test.each([
    ['a token minted for the origin the Host header names is served', { host: 'processor.example.com' }, 200],
    [
      'the same token arriving under another Host (a platform probe host) is refused',
      { host: 'abc123.eu-central-1.awsapprunner.com' },
      403,
    ],
    ['a request whose Host is unusable is refused, not served on an undefined origin', { host: 'a b' }, 403],
    [
      'X-Forwarded-Host never widens the gate: a forged header beside a foreign Host is refused',
      { host: 'abc123.eu-central-1.awsapprunner.com', 'x-forwarded-host': 'processor.example.com' },
      403,
    ],
  ])('%s', async (_label, hostHeaders, expected) => {
    const app = await buildDerivedApp();

    const res = await app.inject({
      method: 'GET',
      url: '/operations/store-config',
      headers: { authorization: tokenForHost, ...hostHeaders },
    });

    expect(res.statusCode).toBe(expected);
    await app.close();
  });
});
