import * as dotenv from 'dotenv';
dotenv.config();

import './infrastructure/bootstrap/global';
import './composition-root';
import { getConfig } from './infrastructure/config/config';
import { assertCommercetoolsCredentials } from './infrastructure/boot/commercetools-credentials-guard';
import { assertEncryptionKeyRequired, assertEncryptionKeyStrength } from './infrastructure/crypto/encryption-key-guard';
import { assertReturnFailureUrlConfigured, returnLegBootNotice } from './infrastructure/boot/return-leg-guard';
import { setupFastify } from './infrastructure/http/server/server';

/**
 * Fail fast on what cannot degrade (credentials, the encryption key, the failure sink); report on stdout what
 * merely falls back (an open allowlist). Stdout, because the Merchant Center's log panel shows nothing else.
 */
(async () => {
  const notices: string[] = [];
  try {
    assertCommercetoolsCredentials();
    assertEncryptionKeyStrength();
    assertEncryptionKeyRequired();
    assertReturnFailureUrlConfigured(getConfig().returnFailureUrl);

    notices.push('public origin: derived per request from the Host header');
    notices.push(returnLegBootNotice(getConfig().allowedReturnOrigins));
  } catch (error) {
    process.stdout.write(`Startup aborted: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${notices.join('\n')}\n`);

  const server = await setupFastify();

  const HOST = '0.0.0.0';
  try {
    await server.listen({
      port: 8080,
      host: HOST,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
})();
