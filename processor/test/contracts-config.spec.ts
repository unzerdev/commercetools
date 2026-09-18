import { describe, expect, it } from '@jest/globals';
import type { AppConfig } from '../src/infrastructure/config/types';

describe('config app-config shapes', () => {
  it('accepts a literal matching the processor config object shape', () => {
    const config: AppConfig = {
      projectKey: 'payment-integration',
      clientId: 'xxx',
      clientSecret: 'xxx',
      jwksUrl: 'https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json',
      jwtIssuer: 'https://mc-api.europe-west1.gcp.commercetools.com',
      authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      apiUrl: 'https://api.europe-west1.gcp.commercetools.com',
      sessionUrl: 'https://session.europe-west1.gcp.commercetools.com',
      checkoutUrl: 'https://checkout.europe-west1.gcp.commercetools.com',
      healthCheckTimeout: 5000,
      requestTimeoutMs: 30000,
      loggerLevel: 'info',
      configManagePermission: 'canManagePspPayments',
      allowedReturnOrigins: [],
      returnFailureUrl: undefined,
    };

    expect(config.projectKey).toBe('payment-integration');
    expect(config.healthCheckTimeout).toBe(5000);
  });
});
