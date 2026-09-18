import { ErrorGeneral, ErrorInvalidField } from '@commercetools/connect-payments-sdk';
import type { StateEffect } from '../../../domain';
import type { OrchestrationEnv } from './env';

/**
 * Whether a shopper URL may be a redirect target: an absolute http(s) URL, and on the allowlist when one is
 * configured. An empty allowlist admits every http(s) origin; the scheme check is what keeps `javascript:`
 * and `data:` targets out of a 302 in that case.
 */
export function isAllowedReturnOrigin(rawUrl: string, env: OrchestrationEnv): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }
  if (env.allowedReturnOrigins.length === 0) {
    return true;
  }
  return env.allowedReturnOrigins.includes(url.origin);
}

/** Reject a shopper return URL that is not http(s) or is off-allowlist at intake; `undefined` means the store default. */
export function assertAllowedReturnUrl(returnUrl: string | undefined, env: OrchestrationEnv): void {
  if (returnUrl === undefined) {
    return;
  }
  if (!isAllowedReturnOrigin(returnUrl, env)) {
    throw new ErrorInvalidField('returnUrl', returnUrl, 'an allowlisted storefront origin', {
      privateMessage:
        'The shopper returnUrl is not an absolute http(s) URL or its origin is not permitted by PSP_ALLOWED_RETURN_ORIGINS.',
    });
  }
}

/** The processor's own return URL carrying the CT payment id; `undefined` when no public base is configured. */
export function buildProcessorReturnUrl(ctPaymentId: string, env: OrchestrationEnv): string | undefined {
  if (!env.returnUrl) {
    return undefined;
  }
  const url = new URL(env.returnUrl);
  url.searchParams.set('ctPaymentId', ctPaymentId);
  return url.toString();
}

/** The single safe failure sink of the return leg. */
export function failureRedirect(env: OrchestrationEnv): string {
  if (!env.returnFailureUrl) {
    throw new ErrorGeneral('No return failure URL is configured for the return leg.', {
      privateMessage: 'PSP_RETURN_FAILURE_URL is unset; the return leg has no safe failure redirect target.',
    });
  }
  return env.returnFailureUrl;
}

/** The storefront redirect with the outcome appended; re-validated as an allowed http(s) target, else the failure sink. */
export function redirectWithStatus(
  shopperReturnUrl: string | undefined,
  status: 'approved' | 'pending' | 'rejected',
  env: OrchestrationEnv,
): string {
  if (!shopperReturnUrl || !isAllowedReturnOrigin(shopperReturnUrl, env)) {
    env.logger.warn(
      'Stored shopper return URL is absent, not http(s) or off-allowlist; redirecting to the safe failure URL',
    );
    return failureRedirect(env);
  }
  const url = new URL(shopperReturnUrl);
  url.searchParams.set('status', status);
  return url.toString();
}

/** The shopper-facing outcome on the redirect. */
export function statusForReturn(effect: StateEffect): 'approved' | 'pending' | 'rejected' {
  if (effect.kind === 'no-op') {
    return 'pending';
  }
  switch (effect.transaction.state) {
    case 'Success':
      return 'approved';
    case 'Failure':
      return 'rejected';
    default:
      return 'pending';
  }
}
