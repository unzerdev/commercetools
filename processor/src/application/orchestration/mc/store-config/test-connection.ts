import type { ConnectionTestResult } from '../../../../domain';
import { type OrchestrationDeps, targetStoreKey } from '../../shared';
import type { TestConnectionCtx } from './test-connection-ctx';

/** The store's active-environment credentials probed against the provider; secret-free. */
export async function testConnection(ctx: TestConnectionCtx, deps: OrchestrationDeps): Promise<ConnectionTestResult> {
  const cfg = await deps.ports.configResolver.resolve(targetStoreKey(ctx.storeKey, deps));
  return deps.provider.introspection.testConnection(cfg);
}
