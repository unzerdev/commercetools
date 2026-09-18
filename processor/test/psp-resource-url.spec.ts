/**
 * `providers/psp/resource-url` — the ONE reader of an Unzer resource url.
 *
 * Unzer names a transaction leg only by its URL: no id field, no parent-kind field. So two questions are
 * answered out of that string, and THREE call sites depend on the answers agreeing — the webhook's
 * settling-leg selection, the status interpretation's refund-vs-void reading, and the order panel's display
 * kind. A leg the panel books as a refund while the webhook settles it as a void is one vendor operation
 * counted twice in commercetools, so these are unit-pinned here rather than only through the three
 * consumers: the module previously existed as three divergent copies, and reverting either the
 * fragment strip or the scheme-relative branch left the whole suite green.
 *
 * The rule under test is that both readers work on the PATH. An origin, a query or a fragment may contain
 * anything — a host named `authorize.unzer.com`, `…/cancels/x?ref=/authorize/y` — without saying a word
 * about the resource.
 */
import { describe, expect, it } from '@jest/globals';
import { resourceId, reversesAuthorization } from '../src/providers/psp/status';

const REFUND_LEG = 'https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1/cancels/s-cnl-1';
const VOID_LEG = 'https://sbx-api.unzer.com/v1/payments/s-pay-1/authorize/s-aut-1/cancels/s-cnl-1';

describe('resourceId — the leg id Unzer embeds in the path', () => {
  it('takes the trailing path segment of the real vendor shapes', () => {
    expect(resourceId('https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1')).toBe('s-chg-1');
    expect(resourceId(REFUND_LEG)).toBe('s-cnl-1');
    expect(resourceId(VOID_LEG)).toBe('s-cnl-1');
  });

  it('reads the path out of a scheme-relative or path-only url', () => {
    expect(resourceId('//sbx-api.unzer.com/v1/payments/s-pay-1/charges/s-chg-1')).toBe('s-chg-1');
    expect(resourceId('/v1/payments/s-pay-1/charges/s-chg-1')).toBe('s-chg-1');
    expect(resourceId('v1/payments/s-pay-1/charges/s-chg-1')).toBe('s-chg-1');
  });

  it('drops a query and a fragment, in either order, so neither rides the id', () => {
    expect(resourceId(`${REFUND_LEG}?expand=true`)).toBe('s-cnl-1');
    expect(resourceId(`${REFUND_LEG}#frag`)).toBe('s-cnl-1');
    expect(resourceId(`${REFUND_LEG}?expand=true#frag`)).toBe('s-cnl-1');
    expect(resourceId(`${REFUND_LEG}#frag?expand=true`)).toBe('s-cnl-1');
  });

  it('ignores a trailing slash and empty path segments', () => {
    expect(resourceId(`${REFUND_LEG}/`)).toBe('s-cnl-1');
    expect(resourceId('https://sbx-api.unzer.com/v1//payments//s-pay-1//charges//s-chg-1')).toBe('s-chg-1');
  });

  // A HOST is never a resource id: an origin with no path names nothing, and a bare host must not become
  // the identity a settlement is recorded under.
  it('names nothing when the url carries no path', () => {
    expect(resourceId('https://sbx-api.unzer.com')).toBe('');
    expect(resourceId('https://sbx-api.unzer.com/')).toBe('');
    expect(resourceId('//sbx-api.unzer.com')).toBe('');
    expect(resourceId('')).toBe('');
    expect(resourceId(undefined)).toBe('');
  });
});

describe('reversesAuthorization — void or refund, read off the path', () => {
  it('separates the two vendor cancellation shapes', () => {
    expect(reversesAuthorization(VOID_LEG)).toBe(true);
    expect(reversesAuthorization(REFUND_LEG)).toBe(false);
  });

  it('holds for scheme-relative and path-only urls, including one with no leading slash', () => {
    expect(reversesAuthorization('//sbx-api.unzer.com/v1/payments/p/authorize/a/cancels/c')).toBe(true);
    expect(reversesAuthorization('/v1/payments/p/authorize/a/cancels/c')).toBe(true);
    // No leading slash: the reader guarantees one, so the `/authorize/` boundary still matches.
    expect(reversesAuthorization('authorize/a/cancels/c')).toBe(true);
  });

  // The three consumers must agree, and they only can if the origin, query and fragment are excluded: each
  // of these is a refund whose surrounding text mentions the authorize resource.
  it('never reads a void out of the origin, the query or the fragment', () => {
    expect(reversesAuthorization('https://authorize.unzer.com/v1/payments/p/charges/c/cancels/x')).toBe(false);
    expect(reversesAuthorization('//authorize/v1/payments/p/charges/c/cancels/x')).toBe(false);
    expect(reversesAuthorization(`${REFUND_LEG}?ref=/authorize/x`)).toBe(false);
    expect(reversesAuthorization(`${REFUND_LEG}#/authorize/x`)).toBe(false);
  });

  it('matches the vendor segment exactly — not a lookalike or an encoded one', () => {
    expect(reversesAuthorization('https://sbx-api.unzer.com/v1/payments/p/AUTHORIZE/a/cancels/c')).toBe(false);
    expect(reversesAuthorization('https://sbx-api.unzer.com/v1/payments/p/%61uthorize/a/cancels/c')).toBe(false);
    // A trailing `…/authorize` names the resource itself, not a cancellation OF it, so it is not a void.
    expect(reversesAuthorization('https://sbx-api.unzer.com/v1/payments/p/authorize')).toBe(false);
  });

  it('answers refund — the fail-closed reading — for a url that names no parent at all', () => {
    expect(reversesAuthorization('https://sbx-api.unzer.com')).toBe(false);
    expect(reversesAuthorization('')).toBe(false);
    expect(reversesAuthorization(undefined)).toBe(false);
  });
});
