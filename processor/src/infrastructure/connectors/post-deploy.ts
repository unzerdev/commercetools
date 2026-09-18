import 'dotenv/config';
import { provider } from '../../composition-root';
import { assertCommercetoolsCredentials } from '../boot/commercetools-credentials-guard';
import { assertEncryptionKeyRequired, assertEncryptionKeyStrength } from '../crypto/encryption-key-guard';
import { reencryptStoreConfigs } from './reencrypt';
import { reregisterWebhooks } from './reregister-webhooks';

/**
 * The encryption-key rotation, and nothing else: re-encrypt every stored store-config secret under the
 * current key, then re-register the webhooks whose capability token that key derives. Re-encryption goes
 * first, so an unreadable secret aborts before any subscription is dropped. Everything is written to stdout:
 * the Merchant Center's post-deploy log panel shows nothing else.
 */
export async function postDeploy() {
  assertCommercetoolsCredentials();
  assertEncryptionKeyRequired();
  assertEncryptionKeyStrength();

  await reencryptStoreConfigs();
  await reregisterWebhooks(provider);
}

async function runPostDeployScripts() {
  try {
    await postDeploy();
  } catch (error) {
    if (error instanceof Error) {
      process.stdout.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runPostDeployScripts();
}
