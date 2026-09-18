/** @type {import('ts-jest').JestConfigWithTsJest} */

// `require` rather than `import`: this file assigns `module.exports`, and an `import` here makes
// jest load it as an ES module, where `__dirname` does not exist.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Whether the repository is checked out AROUND this application. `connect validate` builds each
 * application from its own directory alone: the buildpack image carries `processor/` and nothing
 * beside it, and it then runs `npm test` in there. The specs below read the repository around the
 * application - `connect.yaml`, `mc/src/types/config.ts`, `deployment/onprem/*` - so in that image
 * they fail to RUN, on ENOENT, and the npm-tester reports the whole suite red.
 *
 * They are not coverage this gives up: the per-application `gate` job in
 * `.github/workflows/ci.yml` runs this same suite on a full checkout, where the probe finds the tree
 * and every one of them executes. The probe names `connect.yaml` because it is the connector's own
 * root marker: it exists in every checkout and in no application directory.
 */
const repoTreeAvailable = existsSync(join(__dirname, '..', 'connect.yaml'));

/** The specs that read files outside `processor/`, and therefore only run on a full checkout. */
const REPO_TREE_SPECS = [
  '<rootDir>/test/brand-defaults\\.spec\\.ts',
  '<rootDir>/test/connect-yaml\\.spec\\.ts',
  '<rootDir>/test/mc-payment-methods-contract\\.spec\\.ts',
  '<rootDir>/test/onprem-build-config\\.spec\\.ts',
  '<rootDir>/test/root-package\\.spec\\.ts',
];

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
  // The integration specs build a real Fastify app and run real HMAC verification per test. Jest's
  // 5s default is enough on a warm tree but not on a cold one (a fresh `npm ci` in a generated brand
  // artifact, all workers compiling at once), where they flake. A flaky gate is a gate nobody trusts.
  testTimeout: 30_000,
  // `jwks-rsa` (via the payments SDK) pulls jose 6, which ships ESM only. Compile it down for the
  // CJS runtime; every other node_modules package still loads untransformed.
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  testPathIgnorePatterns: ['/node_modules/', ...(repoTreeAvailable ? [] : REPO_TREE_SPECS)],
};
