import type { EnvironmentMode } from '../../../../domain';
import type { OrchestrationDeps, OrchestrationLogger } from '../../shared';
import type { ConnectedEnv } from './connected-env';

/** Drop the given environments' method blocks; delete the object once no environment's config is left. */
export async function clearMethodConfig(
  storeKey: string,
  modes: EnvironmentMode[],
  deps: OrchestrationDeps,
): Promise<void> {
  const { value, version } = await deps.ports.paymentMethodsStore.readWithVersion(storeKey);
  if (!value) {
    return;
  }

  const environments = { ...value.environments };
  let changed = false;
  for (const mode of modes) {
    if (environments[mode]) {
      delete environments[mode];
      changed = true;
    }
  }

  if (Object.keys(environments).length === 0) {
    await deps.ports.paymentMethodsStore.delete(storeKey, version);
    return;
  }
  if (!changed) {
    return;
  }
  await deps.ports.paymentMethodsStore.write(storeKey, { ...value, environments }, version);
}

/** A rotated environment's method list described the previous account; drop it best-effort after the connection is persisted. */
export async function clearRotatedMethodConfig(
  storeKey: string,
  rotated: ConnectedEnv[],
  deps: OrchestrationDeps,
  logger: OrchestrationLogger,
): Promise<void> {
  const modes = rotated.filter((env) => env.previousCfg).map((env) => env.mode);
  if (modes.length === 0) {
    return;
  }

  try {
    await clearMethodConfig(storeKey, modes, deps);
  } catch (error) {
    logger.warn('Key rotation: could not clear the previous account payment-method configuration', {
      storeKey,
      modes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
