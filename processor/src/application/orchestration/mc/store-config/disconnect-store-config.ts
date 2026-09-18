import { assertStoreKeyNotReserved, type OrchestrationDeps, targetStoreKey } from '../../shared';
import { clearMethodConfig } from './clear-method-config';
import type { DisconnectStoreConfigCtx } from './disconnect-store-config-ctx';
import { overlayProbeConfig } from './probe-config';

/**
 * `DELETE /operations/store-config`: drop the environment's method config, clear its credentials (deleting
 * the object once none remain), then best-effort delete its vendor subscriptions by the recorded ids.
 */
export async function disconnectStoreConfig(ctx: DisconnectStoreConfigCtx, deps: OrchestrationDeps): Promise<void> {
  assertStoreKeyNotReserved(ctx.storeKey, deps);

  const { configStore, configResolver } = deps.ports;
  const storeKey = targetStoreKey(ctx.storeKey, deps);

  const stored = await configStore.read(storeKey);
  const mode = ctx.mode ?? stored?.mode ?? 'sandbox';
  const disconnectingEnv = stored?.environments?.[mode];

  await clearMethodConfig(storeKey, [mode], deps);

  const cleared = await configStore.clearEnvCredentials(storeKey, mode);
  if (cleared && !cleared.remainingCredentials) {
    await configStore.delete(storeKey, cleared.version);
  }

  if (stored && disconnectingEnv?.credentials?.privateKey) {
    const base = await configResolver.resolve(storeKey);
    const cfg = overlayProbeConfig(base, stored, mode);
    try {
      await deps.provider.webhook.deleteWebhooks(cfg, disconnectingEnv.webhookIds);
    } catch {
      /* a failed cleanup must not surface as a disconnect failure */
    }
  }
}
