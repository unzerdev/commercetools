import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildOrchestrationEnv } from '../src/composition-root';
import * as Context from '../src/infrastructure/bootstrap/libs/fastify/context/context';

/**
 * `buildOrchestrationEnv` — the composition root's resolved `OrchestrationEnv`. The processor's own
 * `/return` base is DERIVED from the current public origin - the origin the current request's Host header
 * names, else the one Connect assigned - not configured separately: one origin, no drift. `returnUrl` is a
 * per-access getter, so the derivation is observed at call time, inside the request that needs it.
 */
const ENV_KEYS = ['CONNECT_SERVICE_URL'] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  saved[key] = process.env[key];
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe('buildOrchestrationEnv return-URL derivation', () => {
  it('derives returnUrl as the request-derived origin + /return', () => {
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://derived.example' });

    expect(buildOrchestrationEnv().returnUrl).toBe('https://derived.example/return');
  });

  it('falls back to the origin Connect assigned when no request names one', () => {
    process.env.CONNECT_SERVICE_URL = 'https://proc.example.test/';

    expect(buildOrchestrationEnv().returnUrl).toBe('https://proc.example.test/return');
  });

  it('the request origin wins over the one Connect assigned', () => {
    process.env.CONNECT_SERVICE_URL = 'https://proc.example.test';
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://derived.example' });

    expect(buildOrchestrationEnv().returnUrl).toBe('https://derived.example/return');
  });

  it('returnUrl is undefined when nothing names an origin', () => {
    // Outside a request the context is empty; the consumers of `returnUrl` all handle `undefined`.
    expect(buildOrchestrationEnv().returnUrl).toBeUndefined();
  });
});
