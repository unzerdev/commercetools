import { describe, expect, it } from '@jest/globals';
import { originFromHost } from '../src/infrastructure/http/origin-from-host';

/**
 * The origin a request's Host header names, which is what the processor's own origin is derived from when
 * configured. It feeds the token-audience gate, the webhook URL and the shopper return base, so it must be
 * a bare origin comparable to `URL.origin`, derived from Host alone, and `undefined` for anything odd.
 */
describe('http/origin-from-host', () => {
  it('derives an https origin from the public Connect host', () => {
    expect(originFromHost('service-gzyfkx59mf.eu-central-1.aws.preview.commercetools.app')).toBe(
      'https://service-gzyfkx59mf.eu-central-1.aws.preview.commercetools.app',
    );
  });

  it('lower-cases an upper-cased Host header', () => {
    expect(originFromHost('SERVICE-GZYFKX59MF.EU-CENTRAL-1.AWS.PREVIEW.COMMERCETOOLS.APP')).toBe(
      'https://service-gzyfkx59mf.eu-central-1.aws.preview.commercetools.app',
    );
  });

  it('strips the default port and keeps a non-default one', () => {
    expect(originFromHost('processor.example.com:443')).toBe('https://processor.example.com');
    expect(originFromHost('processor.example.com:8443')).toBe('https://processor.example.com:8443');
  });

  it('uses http for loopback hosts, where TLS is not in front of the process', () => {
    expect(originFromHost('localhost')).toBe('http://localhost');
    expect(originFromHost('localhost:8080')).toBe('http://localhost:8080');
    expect(originFromHost('localhost:80')).toBe('http://localhost');
    expect(originFromHost('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(originFromHost('[::1]:8080')).toBe('http://[::1]:8080');
  });

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['duplicated header', ['a.example', 'b.example']],
    ['a path', 'evil.example/x'],
    ['credentials', 'user@evil.example'],
    ['whitespace inside', 'a b.example'],
    ['percent encoding', '%65xample.com'],
    ['a non-numeric port', 'evil.example:notaport'],
    ['a query', 'evil.example?x=1'],
  ])('returns undefined for %s', (_label, value) => {
    expect(originFromHost(value as string | string[] | undefined)).toBeUndefined();
  });

  it('never yields the opaque origin "null"', () => {
    for (const value of ['evil.example:99999', 'a..b', '-a.example']) {
      expect(originFromHost(value)).not.toBe('null');
    }
  });
});
