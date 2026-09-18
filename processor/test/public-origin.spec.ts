import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Context from '../src/infrastructure/bootstrap/libs/fastify/context/context';
import { currentPublicOrigin } from '../src/infrastructure/config/public-origin';

/**
 * The one resolution point for "what is this processor's origin": the current request's Host-derived
 * origin, then (post-deploy only, where no request exists) the origin Connect assigned.
 */
const saved = process.env.CONNECT_SERVICE_URL;

beforeEach(() => {
  delete process.env.CONNECT_SERVICE_URL;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (saved === undefined) {
    delete process.env.CONNECT_SERVICE_URL;
  } else {
    process.env.CONNECT_SERVICE_URL = saved;
  }
});

describe('config/public-origin', () => {
  it('takes the request context publicOrigin', () => {
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://derived.example' });

    expect(currentPublicOrigin()).toBe('https://derived.example');
  });

  it('the request origin wins over the one Connect assigned', () => {
    process.env.CONNECT_SERVICE_URL = 'https://service-abc.eu-central-1.aws.commercetools.app/';
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ publicOrigin: 'https://derived.example' });

    expect(currentPublicOrigin()).toBe('https://derived.example');
  });

  it('falls back to the CONNECT_SERVICE_URL origin outside a request (post-deploy)', () => {
    process.env.CONNECT_SERVICE_URL = 'https://service-abc.eu-central-1.aws.commercetools.app/';

    expect(currentPublicOrigin()).toBe('https://service-abc.eu-central-1.aws.commercetools.app');
  });

  it('is undefined when nothing names an origin', () => {
    expect(currentPublicOrigin()).toBeUndefined();
  });

  it('ignores a CONNECT_SERVICE_URL that is not a URL', () => {
    process.env.CONNECT_SERVICE_URL = 'not-a-url';

    expect(currentPublicOrigin()).toBeUndefined();
  });
});
