import { afterEach, describe, expect, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from '../src/infrastructure/http/routes/public/health.route';

/**
 * `GET /health` is the one route that says "this deployment is up, and it is THIS build" to a caller
 * holding no token at all - the Connect health check, an operator's browser, a monitor. It is PUBLIC and
 * must stay free of anything a public caller may not learn: no configuration, no downstream state.
 */
describe('health.route (public GET /health)', () => {
  let fastify: FastifyInstance;

  afterEach(async () => {
    await fastify.close();
  });

  test('answers 200 with the build identity and NO auth required', async () => {
    fastify = Fastify();
    await fastify.register(healthRoutes, { name: '@psp/processor', version: '1.2.3' });
    await fastify.ready();

    const response = await fastify.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', name: '@psp/processor', version: '1.2.3' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('the body carries exactly the three identity fields, nothing from the environment', async () => {
    fastify = Fastify();
    await fastify.register(healthRoutes, { name: 'n', version: 'v' });
    await fastify.ready();

    const body = (await fastify.inject({ method: 'GET', url: '/health' })).json();

    expect(Object.keys(body).sort()).toEqual(['name', 'status', 'version']);
  });
});
