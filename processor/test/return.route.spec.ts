import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { returnRoutes } from '../src/infrastructure/http/routes/public/return.route';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

/**
 * The public return leg, now thin over the `reflectReturn` orchestrator. `GET /return` must be
 * PUBLIC — no session/oauth preHandler — and reply 302 to the redirect target the orchestrator
 * computes. It sits OUTSIDE the /operations CT-auth group, so this suite registers it with NO auth
 * hook (mirroring production wiring) and injects fake `CorePorts` + `ProviderModule` + env.
 */
describe('return.route (public GET /return)', () => {
  let fastify: FastifyInstance;
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;

  async function buildApp(env = makeFakeEnv()): Promise<void> {
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(returnRoutes, { ports, provider, env });
    await fastify.ready();
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('replies 302 to the storefront redirect target with NO auth required', async () => {
    await buildApp();

    const response = await fastify.inject({
      method: 'GET',
      url: '/return?ctPaymentId=123456&hostedCheckoutId=hc-1&RETURNMAC=mac-1',
    });

    expect(response.statusCode).toBe(302);
    // The fake return handler yields the allowlisted shopper URL; the leg appends the outcome status.
    expect(response.headers.location).toMatch(/^https:\/\/shop\.test\/return\?status=/);
    // The raw query (incl. the vendor-appended RETURNMAC + hostedCheckoutId) is forwarded verbatim.
    expect(provider.returnLeg.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: expect.objectContaining({ RETURNMAC: 'mac-1' }) }),
    );
  });

  test('a return-leg failure is issued as a 302 to the safe failure target (never a 500)', async () => {
    // A verification/vendor failure inside the orchestrator resolves to the configured safe failure URL.
    provider.returnLeg.resolve = jest.fn<typeof provider.returnLeg.resolve>().mockRejectedValue(new Error('bad mac'));
    await buildApp();

    const response = await fastify.inject({ method: 'GET', url: '/return?ctPaymentId=unknown&RETURNMAC=whatever' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://shop.test/failed');
  });

  test('missing ctPaymentId → 400 from schema validation', async () => {
    await buildApp();

    const response = await fastify.inject({ method: 'GET', url: '/return?RETURNMAC=mac-1' });

    expect(response.statusCode).toBe(400);
    expect(provider.returnLeg.resolve).not.toHaveBeenCalled();
  });

  test('a failure with NO configured safe failure URL surfaces as a safe 500, never a crash', async () => {
    provider.returnLeg.resolve = jest.fn<typeof provider.returnLeg.resolve>().mockRejectedValue(new Error('boom'));
    await buildApp(makeFakeEnv({ returnFailureUrl: undefined }));

    const response = await fastify.inject({ method: 'GET', url: '/return?ctPaymentId=unknown' });

    expect(response.statusCode).toBe(500);
    expect(response.json().statusCode).toBe(500);
  });
});
