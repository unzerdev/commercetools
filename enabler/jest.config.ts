/** @type {import('ts-jest').JestConfigWithTsJest} */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The processor method table the spec below imports, resolved from `process.cwd()`: this config is
 * loaded both by Node's own type stripping (as ESM, so no `__dirname`) and by ts-node (as CommonJS, so no
 * `import.meta`), and a run is driven either from `enabler/` or from the repository root.
 */
const methodsFrom = (...prefix: string[]): string =>
  join(...prefix, 'processor', 'src', 'providers', 'psp', 'methods', 'index.ts');

/** False in the `connect validate` image, which builds this application without the processor beside it. */
const onFullCheckout = existsSync(methodsFrom('..')) || existsSync(methodsFrom('.'));

/** The spec that imports from `processor/`, and therefore only runs on a full checkout. */
const PROCESSOR_TREE_SPECS = ['<rootDir>/test/unzer-method-elements\\.spec\\.ts'];

export default {
  preset: 'ts-jest',
  // The enabler is browser code (document/iframe/window.location/fetch), so tests run under jsdom.
  testEnvironment: 'jsdom',
  // A concrete storefront URL so window.location.href is deterministic (e.g. the hpp returnUrl).
  testEnvironmentOptions: {
    url: 'https://storefront.example/checkout',
  },
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
  testPathIgnorePatterns: ['/node_modules/', ...(onFullCheckout ? [] : PROCESSOR_TREE_SPECS)],
  // Components import *.module.scss for their class names; stub every style import to an empty
  // proxy so class-name lookups resolve to '' instead of trying to compile SCSS in the test run.
  moduleNameMapper: {
    '\\.(scss|css|sass)$': '<rootDir>/test/__mocks__/styleMock.ts',
  },
};
