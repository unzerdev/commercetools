import type { HealthCheck } from '@commercetools/connect-payments-sdk';

/** The commercetools-permissions health check the status endpoint composes. */
export interface PermissionsHealth {
  commercetoolsPermissions(requiredPermissions: string[]): HealthCheck;
}
