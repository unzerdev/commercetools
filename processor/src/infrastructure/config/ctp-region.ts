/** The six commercetools endpoint URLs, derived from one `{cloudRegion}.{cloudProvider}` token. None carries a trailing slash. */
export interface CtpEndpoints {
  authUrl: string;
  apiUrl: string;
  sessionUrl: string;
  checkoutUrl: string;
  jwksUrl: string;
  jwtIssuer: string;
}

/** Local-dev and test convenience only; `connect.yaml` requires the var and declares no default. */
const DEFAULT_REGION = 'europe-west1.gcp';

const REGION_PATTERN = /^[a-z0-9-]+\.[a-z0-9]+$/;

/** A malformed region would re-home the JWKS and issuer host, so it fails the boot rather than validating tokens elsewhere. */
export function ctpEndpointsFromRegion(region: string | undefined): CtpEndpoints {
  const resolved = region?.trim() || DEFAULT_REGION;
  if (!REGION_PATTERN.test(resolved)) {
    throw new Error(
      `Invalid CTP_REGION '${resolved}': expected {cloudRegion}.{cloudProvider} (e.g. europe-west1.gcp, eu-central-1.aws).`,
    );
  }
  const host = (svc: string): string => `https://${svc}.${resolved}.commercetools.com`;
  const mcApi = `https://mc-api.${resolved}.commercetools.com`;
  return {
    authUrl: host('auth'),
    apiUrl: host('api'),
    sessionUrl: host('session'),
    checkoutUrl: host('checkout'),
    jwksUrl: `${mcApi}/.well-known/jwks.json`,
    jwtIssuer: mcApi,
  };
}
