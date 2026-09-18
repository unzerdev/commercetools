import typescriptEslint from '@typescript-eslint/eslint-plugin';
import importX from 'eslint-plugin-import-x';
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

// Absolute ring paths for the import-x/no-restricted-paths zones (matched on resolved import paths).
const ring = (...segments) => path.join(__dirname, 'src', ...segments);

// Zone/ban messages reused across several rule blocks (single-sourced so every occurrence stays in sync).
const DOMAIN_INNERMOST_MSG =
  'domain/ is the innermost ring - it imports nothing internal (no application/infrastructure/providers).';
const PROVIDER_CT_BLIND_MSG =
  'A provider is commercetools-blind - it drives application/ports + application/handlers + domain contracts, never the connect-payments-sdk.';
const VENDOR_SDK_SCOPE_MSG = 'The vendor SDK may be imported only under src/providers/psp/.';

// Shortest-import rule: when a ring barrel (index.ts) re-exports a module, import the barrel,
// never the deeper path. The patterns list every barrel-covered folder.
// Flat-config `no-restricted-imports` does not merge across blocks, so every block below spreads
// this same list into its own options.
const SHORTEST_IMPORT_MSG =
  'Import from the ring barrel (shortest path) - the barrel re-exports this module.';
const BARREL_DEEP_IMPORT_PATTERNS = [
  {
    group: [
      '**/domain/contracts',
      '**/domain/contracts/**',
      '**/domain/payment',
      '**/domain/payment/*',
      '**/domain/config',
      '**/domain/config/*',
      '**/domain/redaction',
      '**/domain/redaction/*',
      '**/application/handlers/*',
      '**/application/handlers/**',
      '**/application/ports/*',
      '**/application/ports/**',
      '**/application/orchestration/*',
      '**/application/orchestration/**',
    ],
    message: SHORTEST_IMPORT_MSG,
  },
];
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

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
        ...globals.node,
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
    },
  },
  {
    // Every imported package must be declared in package.json.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: {
      'import-x': importX,
    },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: ['**/test/**'],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Ring enforcement. `src/` is an onion of concentric rings and
  // imports may only point INWARD:
  //   domain (innermost, pure) ← application (use-cases; domain only)
  //   ← infrastructure (adapters/http/config/bootstrap; inward) and
  //     providers/psp (concrete PSP; domain + application/{ports,handlers} only)
  //   ← composition-root.ts + main.ts (src root; the sole cross-ring wiring site)
  // The internal ring boundaries are enforced on RESOLVED import paths by
  // `import-x/no-restricted-paths` (a violation is a real design error, fixed in
  // code - never by loosening a zone). The vendor / commercetools SDK bans below
  // keep each third-party SDK inside the ring that owns it. Flat-config
  // `no-restricted-imports` does NOT merge options across blocks - the last
  // matching block wins outright - so every SDK block is SELF-CONTAINED and more
  // specific blocks are ordered last. The `@typescript-eslint` variant is used so
  // `import type` is covered too.
  // ---------------------------------------------------------------------------

  {
    // Internal ring boundaries. `basePath` anchors the zone paths at the package root;
    // `target`/`from` match on the resolved file path, so only real cross-ring imports fire.
    files: ['src/**/*.ts'],
    plugins: {
      'import-x': importX,
    },
    settings: {
      // Resolve internal `.ts` imports so no-restricted-paths can match zones on the resolved path.
      'import-x/resolver': {
        node: { extensions: ['.ts', '.js', '.json'] },
      },
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // domain/ is the innermost ring - it imports nothing internal.
            {
              target: ring('domain'),
              from: ring('application'),
              message: DOMAIN_INNERMOST_MSG,
            },
            {
              target: ring('domain'),
              from: ring('infrastructure'),
              message: DOMAIN_INNERMOST_MSG,
            },
            {
              target: ring('domain'),
              from: ring('providers'),
              message: DOMAIN_INNERMOST_MSG,
            },
            // application/ may import domain only.
            {
              target: ring('application'),
              from: ring('infrastructure'),
              message: 'application/ may import domain only - never infrastructure.',
            },
            {
              target: ring('application'),
              from: ring('providers'),
              message: 'application/ may import domain only - never a concrete provider.',
            },
            // providers/ import domain + application/{ports,handlers} only.
            {
              target: ring('providers'),
              from: ring('infrastructure'),
              message: 'A provider is infrastructure-blind - import domain + application/{ports,handlers} only.',
            },
            {
              target: ring('providers'),
              from: ring('application'),
              except: [ring('application', 'ports'), ring('application', 'handlers')],
              message:
                'A provider may import only application/ports + application/handlers - never orchestration or the manifest registry.',
            },
            // only composition-root.ts (src root, outside every zone target) wires a provider.
            {
              target: ring('infrastructure'),
              from: ring('providers'),
              message: 'infrastructure/ is provider-blind - only composition-root.ts wires a concrete provider.',
            },
          ],
        },
      ],
    },
  },

  {
    // Global: the vendor SDK is forbidden everywhere but `providers/psp/**` (re-permitted below).
    // The Unzer client is a hand-rolled fetch client, not a packaged SDK; `vendor-payments-sdk` is the
    // PLACEHOLDER slot a real integration renames to its vendor's package (HOW_TO_CREATE_A_PSP_PROVIDER.md,
    // stage 1) so the boundary stays enforced from the first `npm install`.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vendor-payments-sdk',
              message: VENDOR_SDK_SCOPE_MSG,
            },
          ],
          patterns: BARREL_DEEP_IMPORT_PATTERNS,
        },
      ],
    },
  },

  {
    // providers/* - a concrete PSP is commercetools-BLIND and vendor-SDK-blind (the SDK belongs under
    // providers/psp/, re-permitted below). It drives application/ports + application/handlers +
    // domain contracts, never the connect-payments-sdk.
    files: ['src/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vendor-payments-sdk',
              message: VENDOR_SDK_SCOPE_MSG,
            },
            {
              name: '@commercetools/connect-payments-sdk',
              message: PROVIDER_CT_BLIND_MSG,
            },
          ],
          patterns: BARREL_DEEP_IMPORT_PATTERNS,
        },
      ],
    },
  },

  {
    // ...but providers/psp/ IS the single site allowed to import the vendor SDK. Still
    // commercetools-blind: the connect-payments-sdk stays banned here.
    files: ['src/providers/psp/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@commercetools/connect-payments-sdk',
              message: PROVIDER_CT_BLIND_MSG,
            },
          ],
          patterns: BARREL_DEEP_IMPORT_PATTERNS,
        },
      ],
    },
  },

  {
    // Tests import the same rings the code does; the shortest-import rule holds there too (the
    // vendor-SDK / connect-payments-sdk zone bans above stay src-scoped on purpose - a test may
    // build SDK fixtures).
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: BARREL_DEEP_IMPORT_PATTERNS,
        },
      ],
    },
  },

  {
    // CommonJS jest transformer (down-compiles ESM-only msw deps). Genuinely CommonJS, so the
    // TypeScript/ESM recommended rules do not apply to it.
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
];
