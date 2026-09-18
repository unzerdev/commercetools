import { describe, expect, it } from '@jest/globals';
import { ctpEndpointsFromRegion } from '../src/infrastructure/config/ctp-region';

describe('ctpEndpointsFromRegion', () => {
  it('derives the six URLs for europe-west1.gcp identical to the historical per-URL defaults', () => {
    expect(ctpEndpointsFromRegion('europe-west1.gcp')).toEqual({
      authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      apiUrl: 'https://api.europe-west1.gcp.commercetools.com',
      // NO trailing slash: the SDK appends `/${projectKey}/sessions/…`, and a `//` path 404s.
      sessionUrl: 'https://session.europe-west1.gcp.commercetools.com',
      checkoutUrl: 'https://checkout.europe-west1.gcp.commercetools.com',
      jwksUrl: 'https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json',
      jwtIssuer: 'https://mc-api.europe-west1.gcp.commercetools.com',
    });
  });

  it('derives the aws hosts for eu-central-1.aws', () => {
    const e = ctpEndpointsFromRegion('eu-central-1.aws');
    expect(e.apiUrl).toBe('https://api.eu-central-1.aws.commercetools.com');
    expect(e.sessionUrl).toBe('https://session.eu-central-1.aws.commercetools.com');
    expect(e.jwksUrl).toBe('https://mc-api.eu-central-1.aws.commercetools.com/.well-known/jwks.json');
    expect(e.jwtIssuer).toBe('https://mc-api.eu-central-1.aws.commercetools.com');
  });

  // A trailing slash here is not cosmetic: the payment SDK builds the session read as
  // `${sessionUrl}/${projectKey}/sessions/${id}`, so a slash-terminated base produces `//`, which the
  // session host answers 404 for - and the SDK surfaces that as "Session is not active", failing every
  // shopper request with a 401 that names the wrong cause.
  it('derives no URL with a trailing slash', () => {
    const endpoints = ctpEndpointsFromRegion('eu-central-1.aws');

    for (const [name, url] of Object.entries(endpoints)) {
      expect({ name, endsWithSlash: url.endsWith('/') }).toEqual({ name, endsWithSlash: false });
    }
  });

  it('falls back to europe-west1.gcp for an unset/blank region (local dev + tests)', () => {
    expect(ctpEndpointsFromRegion(undefined).apiUrl).toBe('https://api.europe-west1.gcp.commercetools.com');
    expect(ctpEndpointsFromRegion('   ').apiUrl).toBe('https://api.europe-west1.gcp.commercetools.com');
  });

  it('fails closed on a malformed region that could re-home the JWKS/issuer trust anchor', () => {
    // A `/`, `@`, `#` or extra dots would build a JWKS host other than mc-api.<region>.commercetools.com.
    for (const bad of ['evil.com/x', 'x#', 'a@b', 'a.b.c', 'europe-west1', 'europe west1.gcp', 'GCP.europe']) {
      expect(() => ctpEndpointsFromRegion(bad)).toThrow(/Invalid CTP_REGION/);
    }
  });

  it('always builds the JWKS host as mc-api.<region>.commercetools.com for accepted regions', () => {
    for (const region of ['europe-west1.gcp', 'eu-central-1.aws', 'us-east-2.aws']) {
      expect(new URL(ctpEndpointsFromRegion(region).jwksUrl).host).toBe(`mc-api.${region}.commercetools.com`);
    }
  });
});
