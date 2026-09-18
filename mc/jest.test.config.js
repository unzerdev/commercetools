process.env.ENABLE_NEW_JSX_TRANSFORM = 'true';

const preset = require('@commercetools-frontend/jest-preset-mc-app/typescript/jest-preset');

/**
 * @type {import('@jest/types').Config.ProjectConfig}
 */
module.exports = {
  preset: '@commercetools-frontend/jest-preset-mc-app/typescript',
  // These specs render the app shell against a mocked GraphQL server. Jest's 5s default is enough on
  // a warm tree but not on a cold one (a fresh `npm ci` in a generated brand artifact, every worker
  // compiling at once), where they flake. A flaky gate is a gate nobody trusts.
  testTimeout: 30_000,
  // All specs live under `test/` (repo convention: never co-located in `src/`). Restrict discovery
  // there so the SUT under `src/` is never itself picked up as a test root.
  roots: ['<rootDir>/test'],
  // Concatenated after the preset's own setupFiles; seeds `window.app.entryPointUriPath` so specs that
  // import `constants`/`test-utils` (renderAppWithRedux) can load. See the setup file for why.
  setupFiles: ['<rootDir>/jest.setup.integration.js'],
  // `moduleNameMapper` is not merged with the preset's — spread it explicitly. `AsyncLocaleData`
  // dynamically imports the ESM `moment/dist/locale/*` files, which jest's CJS runtime cannot
  // parse; moment ships CJS twins under `moment/locale/*`.
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^moment/dist/locale/(.*)$': 'moment/locale/$1',
  },
  // The preset already exempts `uuid` from the ignore list — but its pattern anchors on the FIRST
  // `node_modules/`, so it only ever matches a HOISTED uuid. When npm nests one (uuid 14 under
  // `@commercetools-frontend/application-shell-connectors`, which is ESM-only), the lookahead sees
  // `@commercetools-frontend` instead, the file is left untransformed and every spec that renders the app
  // shell dies on `Unexpected token 'export'`. `(.*/)?` lets the exemption match at any depth.
  transformIgnorePatterns: ['node_modules/(?!(.*/)?(uuid|\\.pnpm))'],
};
