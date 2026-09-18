import { type HealthCheck, statusHandler } from '@commercetools/connect-payments-sdk';
import type { StatusCheck, StatusReport } from '../../../domain';
import type { OrchestrationCtx, OrchestrationDeps } from '../shared';

/** `GET /operations/status`: the commercetools permissions check plus the provider's checks; a throwing provider check reads DOWN. */
export async function getStatus(ctx: OrchestrationCtx, deps: OrchestrationDeps): Promise<StatusReport> {
  const { env } = ctx;
  const { ports, provider } = deps;
  const cfg = await ports.configResolver.resolve(ports.configResolver.storeKey());

  let providerChecks: StatusCheck[];
  try {
    providerChecks = await provider.introspection.statusChecks(cfg);
  } catch (e) {
    env.logger.error('Provider status check threw', { error: e instanceof Error ? e.message : String(e) });
    providerChecks = [
      { name: `${provider.key}-connectivity`, status: 'DOWN', message: 'Provider status check failed.' },
    ];
  }

  const missing = await ports.provisioning.missingObjects(provider.paymentCustomType.key);
  const provisioningCheck: HealthCheck = async () => ({
    name: 'connector-provisioning',
    status: missing.length === 0 ? ('UP' as const) : ('DOWN' as const),
    ...(missing.length > 0
      ? {
          message:
            'The connector-owned commercetools objects are missing; save a store connection in the Merchant Center to provision them.',
          details: { missing },
        }
      : {}),
  });

  const handler = await statusHandler({
    timeout: env.status.timeout,
    log: env.status.logger,
    checks: [
      ports.permissionsHealth.commercetoolsPermissions(env.status.requiredPermissions),
      provisioningCheck,
      ...providerChecks.map((check): HealthCheck => async () => ({
        name: check.name,
        status: check.status === 'UP' ? ('UP' as const) : ('DOWN' as const),
        ...(check.message ? { message: check.message } : {}),
        details: { ...(check.details ?? {}), providerStatus: check.status },
      })),
    ],
    metadataFn: async () => env.status.metadata,
  })();

  const body = handler.body as StatusReport & { checks: { status: string }[] };
  return {
    ...body,
    checks: body.checks.map((check) => ({ ...check, status: toCheckStatus(check.status) })) as StatusCheck[],
  };
}

function toCheckStatus(status: string): StatusCheck['status'] {
  return status === 'UP' || status === 'DOWN' || status === 'PARTIALLY_AVAILABLE' ? status : 'DOWN';
}
