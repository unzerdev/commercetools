import { ErrorInvalidField, ErrorInvalidOperation } from '@commercetools/connect-payments-sdk';
import type { EnvironmentMode, StoredStoreConfig } from '../../../../domain';
import { ProviderError } from '../../../../domain';
import type { OrchestrationDeps } from '../../shared';
import type { ConnectedEnv } from './connected-env';
import { overlayProbeConfig } from './probe-config';

export const STORE_MODES: EnvironmentMode[] = ['sandbox', 'live'];

/** Whether the effective credentials differ from the stored ones; a re-sent mask resolves to unchanged. */
export function credentialsChanged(
  effective: Record<string, string> | undefined,
  previous: Record<string, string> | undefined,
): boolean {
  if (!effective || Object.keys(effective).length === 0) {
    return false;
  }
  if (!previous) {
    return true;
  }
  const keys = Object.keys(effective);
  if (keys.length !== Object.keys(previous).length) {
    return true;
  }
  return keys.some((key) => effective[key] !== previous[key]);
}

function wasConnected(stored: StoredStoreConfig | null, mode: EnvironmentMode): boolean {
  const credentials = stored?.environments?.[mode]?.credentials;
  return !!credentials && Object.keys(credentials).length > 0;
}

/** Best-effort delete of the subscriptions registered earlier in the same connect; never masks the original failure. */
export async function rollbackWebhooks(registered: ConnectedEnv[], deps: OrchestrationDeps): Promise<void> {
  for (const { cfg, webhookIds } of registered) {
    try {
      await deps.provider.webhook.deleteWebhooks(cfg, webhookIds);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * For every environment whose credentials changed: probe the keypair, then register the webhook. A probe
 * rejection aborts before any side effect; a rotation drops the outgoing account's subscription first.
 */
export async function connectChangedEnvironments(
  storeKey: string,
  toPersist: StoredStoreConfig,
  stored: StoredStoreConfig | null,
  deps: OrchestrationDeps,
): Promise<ConnectedEnv[]> {
  const changedModes = STORE_MODES.filter((mode) =>
    credentialsChanged(toPersist.environments?.[mode]?.credentials, stored?.environments?.[mode]?.credentials),
  );
  if (changedModes.length === 0) {
    return [];
  }

  const base = await deps.ports.configResolver.resolve(storeKey);
  const targets: ConnectedEnv[] = changedModes.map((mode) => ({
    mode,
    cfg: overlayProbeConfig(base, toPersist, mode),
    ...(stored && wasConnected(stored, mode)
      ? {
          previousCfg: overlayProbeConfig(base, stored, mode),
          previousWebhookIds: stored.environments?.[mode]?.webhookIds,
        }
      : {}),
  }));

  for (const { mode, cfg } of targets) {
    const result = await deps.provider.introspection.testConnection(cfg);
    if (!result.success) {
      const reason = result.message ?? 'the payment provider rejected the supplied credentials';
      if (result.field) {
        throw new ErrorInvalidField(`environments.${mode}.${result.field}`, '<provided>', reason);
      }
      throw new ErrorInvalidOperation(`Connection validation failed: ${reason}`);
    }
  }

  const eventUrl = base.endpoints.webhookUrl;
  if (!eventUrl) {
    throw new ErrorInvalidOperation(
      'Cannot register the webhook subscription: no public webhook URL is resolved for this store.',
    );
  }
  const registered: ConnectedEnv[] = [];
  try {
    for (const target of targets) {
      if (target.previousCfg) {
        try {
          await deps.provider.webhook.deleteWebhooks(target.previousCfg, target.previousWebhookIds);
        } catch {
          /* best-effort cleanup of the outgoing account */
        }
      }
      target.webhookIds = await deps.provider.webhook.registerWebhooks(target.cfg, eventUrl);
      registered.push(target);
    }
  } catch (cause) {
    await rollbackWebhooks(registered, deps);
    if (cause instanceof ProviderError) {
      throw new ErrorInvalidOperation(`Webhook registration failed: ${cause.message}`);
    }
    throw cause;
  }
  return registered;
}
