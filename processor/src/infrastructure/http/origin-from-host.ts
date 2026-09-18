/** Loopback hosts are the one place TLS does not terminate in front of the processor. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `hostname[:port]`, an IPv4, or a bracketed IPv6 - lower-case only, the caller lower-cases first. */
const HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * This processor's own origin as the request's `Host` header names it, or `undefined` when the header is
 * absent, duplicated or not a plain `host[:port]`. Read from `Host` ONLY: the platform ingress routes by it,
 * so a foreign host never reaches this process, whereas `X-Forwarded-Host` is client-settable and would let
 * a merchant token minted for another application pass the audience gate. `https` everywhere but loopback,
 * where TLS is not in front of the process; default ports fall away so the result compares to `URL.origin`.
 */
export function originFromHost(hostHeader: string | string[] | undefined): string | undefined {
  if (typeof hostHeader !== 'string') {
    return undefined;
  }
  const host = hostHeader.trim().toLowerCase();
  if (host === '' || !HOST_PATTERN.test(host)) {
    return undefined;
  }

  const hostname = host.startsWith('[') ? host.replace(/\]:\d+$/, ']') : host.replace(/:\d+$/, '');
  const scheme = LOOPBACK_HOSTNAMES.has(hostname) ? 'http' : 'https';

  let url: URL;
  try {
    url = new URL(`${scheme}://${host}`);
  } catch {
    return undefined;
  }
  const bare =
    url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.origin !== 'null';
  return bare ? url.origin : undefined;
}
