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
  // `moduleNameMapper` is not merged with the preset's — spread it explicitly. `AsyncLocaleData`
  // dynamically imports the ESM `moment/dist/locale/*` files, which jest's CJS runtime cannot
  // parse; moment ships CJS twins under `moment/locale/*`.
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^moment/dist/locale/(.*)$': 'moment/locale/$1',
  },
};
