/**
 * Test-only setup. The MC jest preset (`setup-tests.js`) assigns `window.app` WITHOUT an
 * `entryPointUriPath`, but `src/constants.ts` reads `window.app.entryPointUriPath` at import time to
 * derive `PERMISSIONS`. Any spec that imports `constants` or `test-utils` (i.e. uses `renderAppWithRedux`)
 * would otherwise throw at module load. Seed the dev default so those specs can load. Runs after the
 * preset's own setup (Jest concatenates `setupFiles`, preset first), so `window.app` already exists.
 */
if (
  global.window &&
  global.window.app &&
  !global.window.app.entryPointUriPath
) {
  global.window.app.entryPointUriPath = 'psp-payments';
}
