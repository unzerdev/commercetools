import type { ProviderModule } from '../../application/handlers';
import type { EnvironmentMode, StoreConfig, StoreEnvironmentBlock } from '../../domain';
import { redactWebhookToken } from '../../domain';
import { webhookUrlToken } from '../crypto/crypto';
import { listStoreConfigObjects } from '../persistence/store-config.repository';
import { resolveStoreConfig } from '../config/resolve-store-config';

const STORE_MODES: readonly EnvironmentMode[] = ['sandbox', 'live'];

function holdsCredentials(env: StoreEnvironmentBlock | undefined): boolean {
  return !!env?.credentials && Object.keys(env.credentials).length > 0;
}

/** A per-env `webhookUrl` override carrying a stale token verifies only while the previous key stays configured. */
function warnOnStaleOverrideToken(storeKey: string, mode: string, eventUrl: string): void {
  const trailing = eventUrl.slice(eventUrl.lastIndexOf('/') + 1);
  if (trailing !== webhookUrlToken(storeKey)) {
    process.stdout.write(
      `webhook re-registration warning for store "${storeKey}" (${mode}): the configured webhookUrl override ` +
        'does not carry the current-key token - re-derive and re-save the override before dropping ' +
        'ENCRYPTION_KEY_PREVIOUS, or its deliveries will answer 401\n',
    );
  }
}

/**
 * On a key rotation the webhook token changes, so every credentialed store environment's subscription is
 * deleted (by its recorded ids) and re-registered with the current-key URL. Best-effort per environment; a
 * register that fails after a successful delete is retried once and then reported as stranded.
 */
export async function reregisterWebhooks(provider: ProviderModule): Promise<void> {
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!previous || previous.trim() === '') {
    return;
  }

  const objects = await listStoreConfigObjects();

  let total = 0;
  let reregistered = 0;
  let stranded = 0;
  for (const object of objects) {
    for (const mode of STORE_MODES) {
      const block = object.value.environments?.[mode];
      if (!holdsCredentials(block)) {
        continue;
      }
      total += 1;

      let cfg: StoreConfig;
      let eventUrl: string;
      try {
        cfg = await resolveStoreConfig(object.key, mode);
        const url = cfg.endpoints.webhookUrl;
        if (!url) {
          process.stdout.write(
            `webhook re-registration skipped for store "${object.key}" (${mode}): no webhook URL resolved - CONNECT_SERVICE_URL or ENCRYPTION_KEY unset\n`,
          );
          continue;
        }
        eventUrl = url;
        warnOnStaleOverrideToken(object.key, mode, eventUrl);
        await provider.webhook.deleteWebhooks(cfg, block?.webhookIds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(
          `webhook re-registration failed for store "${object.key}" (${mode}): ${redactWebhookToken(message)}\n`,
        );
        continue;
      }

      try {
        await provider.webhook.registerWebhooks(cfg, eventUrl);
      } catch {
        try {
          await provider.webhook.registerWebhooks(cfg, eventUrl);
        } catch (error) {
          stranded += 1;
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(
            `webhook re-registration STRANDED store "${object.key}" (${mode}): its subscriptions were deleted ` +
              'but registering the current-key URL failed twice - this environment now has NO webhook ' +
              'subscription and needs a re-connect (re-save its credentials in the Merchant Center app): ' +
              `${redactWebhookToken(message)}\n`,
          );
          continue;
        }
      }
      reregistered += 1;
    }
  }

  const strandedSuffix = stranded > 0 ? `, ${stranded} stranded` : '';
  process.stdout.write(
    `webhook re-registration: ${reregistered} of ${total} store environment(s) re-registered${strandedSuffix}\n`,
  );
}
