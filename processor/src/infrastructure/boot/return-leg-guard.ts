/** The failure sink is required at boot: without it the leg answers a 500 at the shopper's redirect instead of a 302. */
export function assertReturnFailureUrlConfigured(returnFailureUrl: string | undefined): void {
  if (!returnFailureUrl?.trim()) {
    throw new Error(
      'PSP_RETURN_FAILURE_URL is required: it is the single safe sink the return leg redirects to on any ' +
        'failure. Unset, the return leg raises a 500 instead of a safe 302. Set it to a storefront failure URL.',
    );
  }
}

/** The boot line naming the allowlist mode: open when PSP_ALLOWED_RETURN_ORIGINS is empty, else the count. */
export function returnLegBootNotice(allowedReturnOrigins: readonly string[]): string {
  if (allowedReturnOrigins.length === 0) {
    return (
      'return leg: PSP_ALLOWED_RETURN_ORIGINS is empty - every http(s) storefront origin is accepted as a ' +
      'shopper return URL; set it to restrict redirect targets'
    );
  }
  return `return leg: ${allowedReturnOrigins.length} allowlisted storefront origin(s)`;
}
