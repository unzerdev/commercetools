import { describe, expect, it } from '@jest/globals';
import { isAllowedReturnOrigin, redirectWithStatus } from '../src/application/orchestration';
import { makeFakeEnv } from './support/fake-provider-module';

/**
 * The one predicate both return-leg checks (intake and redirect) run. An empty allowlist admits every
 * http(s) origin - and ONLY http(s): with the allowlist open, the scheme check is what keeps a
 * `javascript:` or `data:` target the storefront supplied out of a 302.
 */
describe('return-leg allowlist predicate', () => {
  const open = makeFakeEnv({ allowedReturnOrigins: [] });
  const strict = makeFakeEnv({ allowedReturnOrigins: ['https://shop.test'] });

  it.each([
    ['https://shop.test/return?x=1', true, true],
    ['https://other.test/return', true, false],
    ['http://localhost:3000/return', true, false],
    ['javascript:alert(1)', false, false],
    ['data:text/html,x', false, false],
    ['file:///etc/passwd', false, false],
    ['not-a-url', false, false],
  ])('%s -> open allowlist %s, strict allowlist %s', (url, openVerdict, strictVerdict) => {
    expect(isAllowedReturnOrigin(url, open)).toBe(openVerdict);
    expect(isAllowedReturnOrigin(url, strict)).toBe(strictVerdict);
  });
});

/**
 * WHAT THE SHOPPER RETURN URL CARRIES BACK, which the storefront depends on and nothing pinned.
 *
 * The URL is the storefront's own, taken at submit time, so it may already carry a query and a fragment:
 * the demo shop stamps `?flow=<mode>` on it so the returning page can name the front end that paid, and it
 * routes on the hash, so `#/cart` IS the page the shopper is standing on. `status` has to be ADDED to that
 * query rather than replace it, and the fragment has to survive - a redirect built by string concatenation
 * would drop both, and dropping the fragment throws the shopper to `/` at the moment they are told their
 * order exists.
 */
describe('redirectWithStatus preserves what the storefront put in its own return URL', () => {
  const open = makeFakeEnv({ allowedReturnOrigins: [] });

  it('adds status to an existing query and keeps the fragment', () => {
    const target = redirectWithStatus('https://shop.test/demo-shop.html?flow=ct-checkout#/cart', 'approved', open);

    const url = new URL(target);
    expect(url.searchParams.get('flow')).toBe('ct-checkout');
    expect(url.searchParams.get('status')).toBe('approved');
    expect(url.hash).toBe('#/cart');
  });

  it('replaces a status the URL already carried rather than appending a second one', () => {
    const target = redirectWithStatus('https://shop.test/s.html?status=pending&flow=enabler', 'rejected', open);

    expect(new URL(target).searchParams.getAll('status')).toEqual(['rejected']);
    expect(new URL(target).searchParams.get('flow')).toBe('enabler');
  });

  it('sends an off-allowlist return URL to the safe failure redirect instead of the storefront', () => {
    const strict = makeFakeEnv({ allowedReturnOrigins: ['https://shop.test'] });

    const target = redirectWithStatus('https://evil.test/steal?flow=ct-checkout', 'approved', strict);

    expect(target).not.toContain('evil.test');
  });
});
