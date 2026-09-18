import { type HealthCheck, healthCheckCommercetoolsPermissions } from '@commercetools/connect-payments-sdk';
import type { PermissionsHealth } from '../../application/ports';
import { getConfig } from '../config/config';
import { ctServices } from '../commercetools';

/** `PermissionsHealth` over the SDK's permissions probe. */
export class PermissionsHealthAdapter implements PermissionsHealth {
  public commercetoolsPermissions(requiredPermissions: string[]): HealthCheck {
    return healthCheckCommercetoolsPermissions({
      requiredPermissions,
      ctAuthorizationService: ctServices.authorization,
      projectKey: getConfig().projectKey,
    });
  }
}
