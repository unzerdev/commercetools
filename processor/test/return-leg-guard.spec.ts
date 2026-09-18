import { describe, expect, it } from '@jest/globals';
import { assertReturnFailureUrlConfigured, returnLegBootNotice } from '../src/infrastructure/boot/return-leg-guard';

/**
 * Boot guard for the shopper return leg's public config. The single safe sink `PSP_RETURN_FAILURE_URL` is
 * required (a runtime 500 when unset), so its absence stops the boot rather than surfacing at the shopper's
 * redirect. The allowlist `PSP_ALLOWED_RETURN_ORIGINS` is OPTIONAL: empty admits every http(s) origin, and
 * the boot says so on stdout instead of refusing.
 */
describe('config/return-leg-guard', () => {
  it('passes with a failure URL and an empty allowlist', () => {
    expect(() => assertReturnFailureUrlConfigured('https://shop.example/failed')).not.toThrow();
  });

  it('throws when PSP_RETURN_FAILURE_URL is unset', () => {
    expect(() => assertReturnFailureUrlConfigured(undefined)).toThrow(/PSP_RETURN_FAILURE_URL/);
  });

  it('throws when PSP_RETURN_FAILURE_URL is blank', () => {
    expect(() => assertReturnFailureUrlConfigured('   ')).toThrow(/PSP_RETURN_FAILURE_URL/);
  });

  it('the boot notice names the open allowlist', () => {
    expect(returnLegBootNotice([])).toMatch(/PSP_ALLOWED_RETURN_ORIGINS is empty/);
    expect(returnLegBootNotice([])).toMatch(/every http\(s\) storefront origin is accepted/);
  });

  it('the boot notice counts the configured origins', () => {
    expect(returnLegBootNotice(['https://shop.example', 'https://checkout.example'])).toBe(
      'return leg: 2 allowlisted storefront origin(s)',
    );
  });
});
