import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the connector E2E harness.
 *
 * The suite drives the processor's HTTP surface directly and starts no server: the processor is run
 * EXTERNALLY (`docker compose up`, or `scripts/dev-local.sh`) before the tests, because it needs
 * commercetools credentials that live only in its own `.env`. There is deliberately no `webServer`
 * block and no `baseURL` — every request names `PROCESSOR_URL` itself.
 */

/**
 * Load `e2e/.env` into `process.env` — the file `README.md` tells the runner to create. Node 22's own
 * loader is used (`engines.node` pins 22.x), so the harness needs no dotenv dependency. Values already
 * exported in the shell win, which is what CI wants. This runs BEFORE `defineConfig` below and is
 * re-run in every worker process, so the specs see the same environment; every read of it is
 * deliberately lazy (inside a function) so no module-load order can beat this statement.
 */
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  testDir: './tests',
  // Fail the build if `test.only` is left in the source on CI.
  forbidOnly: !!process.env.CI,
  // The legs run against one live stack, so keep a single worker to avoid cross-test interference.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
