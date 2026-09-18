/** The commercetools client credentials must be set: a placeholder would boot and fail on the first CT call. */
export function assertCommercetoolsCredentials(env: NodeJS.ProcessEnv = process.env): void {
  const missing = ['CTP_PROJECT_KEY', 'CTP_CLIENT_ID', 'CTP_CLIENT_SECRET'].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required: the connector cannot reach commercetools without the API client credentials.`,
    );
  }
}
