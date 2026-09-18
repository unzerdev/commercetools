import typescriptEslint from '@typescript-eslint/eslint-plugin';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-plugin-prettier';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

// The enabler is browser code shipped to storefronts; it must never import ANY @psp/*
// package nor any backend runtime. These bans keep node/backend packages
// out of the browser bundle.
const forbiddenImportPatterns = [
  '@psp/*',
  'fastify',
  'fastify/*',
  '@commercetools/connect-payments-sdk',
  '@commercetools/connect-payments-sdk/*',
];

// The four applications are standalone, so a relative import that climbs out of `enabler/` into a
// sibling application is forbidden. There is exactly one exception - one module, in the one spec
// listed in `sanctionedSpecs` below - because the processor's method catalogue is the single source of
// which codes exist, and a hand-copied second list is the drift that spec exists to catch.
const siblingApplications = ['processor', 'mc', 'mc-view'];

// The one module the exception covers: the method tables, whose own imports are types only, so reading
// it drags no backend module into the jsdom run - the property the exemption's width has to preserve.
const sanctionedModule = 'processor/src/providers/psp/methods';

// The spec the exception covers, asserting a claim the processor's method catalogue owns. It is named
// explicitly rather than as `test/**` so no other spec can follow the path.
const sanctionedSpecs = ['test/unzer-method-elements.spec.ts'];

const crossApplicationMessage =
  `The four applications are standalone; only ${sanctionedModule} may be imported across them, ` +
  `and only in ${sanctionedSpecs.join(' and ')}.`;

const browserRuntimeBan = {
  group: forbiddenImportPatterns,
  message: 'The enabler is browser code — @psp/* packages and backend runtimes are forbidden.',
};

const crossApplicationBan = {
  group: siblingApplications.map((application) => `**/${application}/**`),
  message: crossApplicationMessage,
};

// The same ban with the sanctioned module carved out. It is a `regex` and not a `group` because a `group`
// is gitignore-style: `ignore` returns an excluded PARENT DIRECTORY's verdict before it tests the file, so
// a `!` negation on the file alone beside `**/processor/**` is never consulted. Reaching it means
// re-including every ignored directory on the path — `processor/src/`, `processor/src/providers/`,
// `processor/src/providers/psp/` — beside the file itself: four negation patterns where the regex is one.
// The `regex` matcher runs against the raw specifier, and the negative lookahead spares that one module
// while every other module under `processor/`, `mc/` and `mc-view/` still trips the rule inside the
// sanctioned spec.
const sanctionedModuleBan = {
  regex: `(^|/)(?!${sanctionedModule}$)(${siblingApplications.join('|')})/`,
  message: crossApplicationMessage,
};

export default [
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
    'plugin:prettier/recommended',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      jest,
      prettier,
      'unused-imports': unusedImports,
    },
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
      },

      parser: tsParser,
    },

    rules: {
      'no-redeclare': ['warn'],
      'no-console': ['error'],
      'no-unused-vars': 'off',
      'no-irregular-whitespace': 'warn',
      'unused-imports/no-unused-imports': 'error',

      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'off',

      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
        },
      ],

      'no-restricted-imports': ['error', { patterns: [browserRuntimeBan, crossApplicationBan] }],
    },
  },
  {
    // The single sanctioned cross-application import: the supported-method list has one author,
    // so this spec reads METHOD_TRANSACTION_SUPPORT out of the processor. Flat config REPLACES the
    // `no-restricted-imports` options rather than merging them, so both bans are respread here, with
    // the cross-application one narrowed to the sanctioned module alone.
    files: sanctionedSpecs,
    rules: {
      'no-restricted-imports': ['error', { patterns: [browserRuntimeBan, sanctionedModuleBan] }],
    },
  },
  {
    // Tooling files run under Node, not the browser.
    files: ['*.config.ts', '*.config.mjs', 'jest.config.ts', 'vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
