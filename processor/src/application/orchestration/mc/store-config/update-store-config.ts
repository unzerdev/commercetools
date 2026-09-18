import { ErrorInvalidOperation, ErrorRequiredField } from '@commercetools/connect-payments-sdk';
import type { StoreConfigView, StoredStoreConfig, StoreEnvironmentBlock } from '../../../../domain';
import type { ProviderModule } from '../../../handlers';
import {
  assertStoreKeyNotReserved,
  ensureConnectorObjects,
  type OrchestrationDeps,
  targetStoreKey,
} from '../../shared';
import { clearRotatedMethodConfig } from './clear-method-config';
import {
  connectChangedEnvironments,
  credentialsChanged,
  rollbackWebhooks,
  STORE_MODES,
} from './connect-changed-environments';
import type { ConnectedEnv } from './connected-env';
import type { UpdateStoreConfigCtx } from './update-store-config-ctx';

function isConnecting(env: StoreEnvironmentBlock | undefined): env is StoreEnvironmentBlock {
  return !!env?.credentials && Object.keys(env.credentials).length > 0;
}

/** An environment being connected or re-credentialed must carry the provider's required connection fields. */
function assertConnectionComplete(
  toPersist: StoredStoreConfig,
  stored: StoredStoreConfig | null,
  provider: ProviderModule,
): void {
  for (const mode of STORE_MODES) {
    const env = toPersist.environments?.[mode];
    if (!isConnecting(env)) {
      continue;
    }
    if (!credentialsChanged(env.credentials, stored?.environments?.[mode]?.credentials)) {
      continue;
    }
    const [missing] = provider.config.missingConnectionFields(env);
    if (missing) {
      throw new ErrorRequiredField(`environments.${mode}.${missing}`);
    }
  }
}

/** Carry the server-owned subscription ids onto the document about to be written. */
function applyWebhookIds(
  toPersist: StoredStoreConfig,
  stored: StoredStoreConfig | null,
  registered: ConnectedEnv[],
): StoredStoreConfig {
  const justRegistered = new Map(registered.map((env) => [env.mode, env.webhookIds ?? []]));
  const environments = { ...(toPersist.environments ?? {}) };
  let changed = false;

  for (const mode of STORE_MODES) {
    const block = environments[mode];
    if (!block) {
      continue;
    }
    const ids = justRegistered.get(mode) ?? stored?.environments?.[mode]?.webhookIds;
    if (ids && ids.length > 0) {
      environments[mode] = { ...block, webhookIds: ids };
      changed = true;
    }
  }

  return changed ? { ...toPersist, environments } : toPersist;
}

/**
 * `PUT /operations/store-config`: validate settings, provision the connector's commercetools objects,
 * reconcile masked secrets, enforce the required connection fields, probe and subscribe every changed
 * environment, then CAS-write. Nothing is persisted on any failure; webhooks registered before a failed
 * write are rolled back.
 */
export async function updateStoreConfig(ctx: UpdateStoreConfigCtx, deps: OrchestrationDeps): Promise<StoreConfigView> {
  const { provider, ports } = deps;

  assertStoreKeyNotReserved(ctx.storeKey, deps);

  if (ctx.body.settings !== undefined) {
    const validation = provider.config.validate(ctx.body.settings);
    if (!validation.valid) {
      throw new ErrorInvalidOperation(`Invalid store settings: ${validation.errors?.join('; ')}`);
    }
  }

  await ensureConnectorObjects(deps);

  const storeKey = targetStoreKey(ctx.storeKey, deps);
  const { value: stored, version } = await ports.configStore.readWithVersion(storeKey);

  const toPersist = provider.config.reconcileSecrets(ctx.body as StoredStoreConfig, stored);

  assertConnectionComplete(toPersist, stored, provider);

  const registered = await connectChangedEnvironments(storeKey, toPersist, stored, deps);

  let persisted: StoredStoreConfig;
  try {
    persisted = await ports.configStore.write(storeKey, applyWebhookIds(toPersist, stored, registered), version);
  } catch (cause) {
    await rollbackWebhooks(registered, deps);
    throw cause;
  }

  await clearRotatedMethodConfig(storeKey, registered, deps, ctx.env.logger);

  return provider.config.redact(persisted);
}
