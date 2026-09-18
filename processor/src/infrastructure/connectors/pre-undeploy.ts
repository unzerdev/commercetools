import 'dotenv/config';

/**
 * Deliberately empty: commercetools refuses to delete a State or Type still referenced by a Payment, so
 * nothing post-deploy created is this hook's to remove. The vendor subscription goes with the store disconnect.
 */
async function preUndeploy() {}

async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    if (error instanceof Error) {
      process.stdout.write(`Pre-undeploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
run();
