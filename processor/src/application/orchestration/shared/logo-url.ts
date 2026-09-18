import type { ProviderModule } from '../../handlers';
import type { OrchestrationEnv } from './env';

const logoPath = (code: string): string => `/assets/method-logo/${encodeURIComponent(code)}`;

/** The logo url: absolute on the connector's own origin when known, root-relative otherwise. Never persisted. */
export function buildMethodLogoUrl(code: string, env: OrchestrationEnv): string {
  const path = logoPath(code);
  if (!env.returnUrl) {
    return path;
  }
  try {
    return new URL(env.returnUrl).origin + path;
  } catch {
    return path;
  }
}

/** The logo url for a code, or `undefined` when the provider ships no artwork for it. */
export function methodLogoUrlFor(code: string, env: OrchestrationEnv, provider: ProviderModule): string | undefined {
  return provider.methodLogos.has(code) ? buildMethodLogoUrl(code, env) : undefined;
}
