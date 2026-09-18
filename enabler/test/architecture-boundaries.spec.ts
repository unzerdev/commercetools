/**
 * Application-boundary guard. The four applications are standalone (CLAUDE.md) and exactly one
 * exception — `test/unzer-method-elements.spec.ts` reads `METHOD_TRANSACTION_SUPPORT` out of the
 * processor so the supported-method list has a single author.
 * `eslint.config.mjs` is the only thing holding that line, so this spec proves the line BITES: the
 * `no-restricted-imports` patterns are linted here through the programmatic ESLint API against synthetic
 * snippets placed at real enabler file paths, and the rule must fire everywhere except that one module in
 * that one named file. The width matters as much as the grant — the sanctioned file's own probes pin
 * that every other cross-application module still trips the rule there, and an unnamed spec under `test/`
 * is refused the very specifier it is granted.
 *
 * The rule matches the import SOURCE STRING, so each probe writes the relative specifier a file at that
 * depth would really use, and its path is absolute so the config's `files` globs select the same blocks
 * they select in `npm run lint`.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// One ESLint init for the whole suite still costs ~2s of child-process start-up.
jest.setTimeout(30000);

const IMPORT_RULE = 'no-restricted-imports';

const PROCESSOR_MODULE = 'processor/src/providers/psp/methods';

/** A processor module the sanction does NOT cover, and one that carries imports of its own. */
const UNSANCTIONED_PROCESSOR_MODULE = 'processor/src/infrastructure/config/config';

/** A value import of `specifier`, the shape any real cross-application reach would take. */
const importFrom = (specifier: string) => `import { X } from '${specifier}';\nexport const y = X;\n`;

/** Every snippet the suite lints, keyed by the claim it settles, each at the path it would live at. */
const PROBES = {
  shippedSrc: { code: importFrom(`../../${PROCESSOR_MODULE}`), file: 'src/__probe__.ts' },
  shippedSrcTypeOnly: {
    code: `import type { X } from '../../${PROCESSOR_MODULE}';\nexport type Y = X;\n`,
    file: 'src/__probe__.ts',
  },
  // The same specifier `methodElementsSpec` is GRANTED, at a different path: the grant is by file, not by
  // how far the import climbs, so an unnamed spec beside the sanctioned one inherits nothing.
  otherSpec: { code: importFrom(`../../${PROCESSOR_MODULE}`), file: 'test/__probe__.spec.ts' },
  mc: { code: importFrom('../../mc/src/__probe__'), file: 'src/__probe__.ts' },
  mcView: { code: importFrom('../../mc-view/src/__probe__'), file: 'src/__probe__.ts' },
  methodElementsSpec: {
    code: importFrom(`../../${PROCESSOR_MODULE}`),
    file: 'test/unzer-method-elements.spec.ts',
  },
  methodElementsSpecBackendRuntime: {
    code: importFrom('fastify'),
    file: 'test/unzer-method-elements.spec.ts',
  },
  methodElementsSpecOtherProcessorModule: {
    code: importFrom(`../../${UNSANCTIONED_PROCESSOR_MODULE}`),
    file: 'test/unzer-method-elements.spec.ts',
  },
  methodElementsSpecMc: {
    code: importFrom('../../mc/src/__probe__'),
    file: 'test/unzer-method-elements.spec.ts',
  },
  methodElementsSpecMcView: {
    code: importFrom('../../mc-view/src/__probe__'),
    file: 'test/unzer-method-elements.spec.ts',
  },
  insideEnabler: {
    code: importFrom('../main'),
    file: 'src/components/__probe__.ts',
  },
} as const;

/**
 * The programmatic `ESLint` API resolves the enabler's flat `eslint.config.mjs`, whose loader uses a
 * dynamic `import()`. Jest's CommonJS VM forbids that (`A dynamic import callback was invoked without
 * --experimental-vm-modules`), so the ESLint API is driven in a clean child Node process — it still lints
 * the REAL `eslint.config.mjs` (cwd = `enabler/`), just outside jest's ESM-restricted sandbox. Every probe
 * goes through one child because the init dominates the cost; the child prints the fired rule ids per key.
 */
const RUNNER = `
const { ESLint } = require('eslint');
const probes = JSON.parse(process.argv[1]);
(async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const fired = {};
  for (const [key, probe] of Object.entries(probes)) {
    const [res] = await eslint.lintText(probe.code, { filePath: probe.filePath });
    fired[key] = res.messages.map((m) => m.ruleId || '');
  }
  process.stdout.write(JSON.stringify(fired));
})();
`;

type Fired = Record<keyof typeof PROBES, string[]>;

let fired: Fired;

beforeAll(() => {
  const payload = Object.fromEntries(
    Object.entries(PROBES).map(([key, probe]) => [
      key,
      { code: probe.code, filePath: join(process.cwd(), probe.file) },
    ]),
  );
  const out = execFileSync(process.execPath, ['-e', RUNNER, JSON.stringify(payload)], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  fired = JSON.parse(out) as Fired;
});

describe('application boundaries (no-restricted-imports)', () => {
  it('NEGATIVE: shipped src/ reaching into the processor is refused', () => {
    expect(fired.shippedSrc).toContain(IMPORT_RULE);
  });

  it('NEGATIVE: a TYPE-ONLY processor import from src/ is refused too', () => {
    expect(fired.shippedSrcTypeOnly).toContain(IMPORT_RULE);
  });

  it('NEGATIVE: an unnamed spec reaching into the processor is refused — the sanction names files, not test/', () => {
    expect(fired.otherSpec).toContain(IMPORT_RULE);
  });

  it('NEGATIVE: reaching into mc/ or mc-view/ is refused', () => {
    expect(fired.mc).toContain(IMPORT_RULE);
    expect(fired.mcView).toContain(IMPORT_RULE);
  });

  it('POSITIVE: the sanctioned spec keeps the one processor import it is allowed', () => {
    expect(fired.methodElementsSpec).not.toContain(IMPORT_RULE);
  });

  it('NEGATIVE: a sanctioned file still cannot import a backend runtime', () => {
    expect(fired.methodElementsSpecBackendRuntime).toContain(IMPORT_RULE);
  });

  it('NEGATIVE: a sanctioned file cannot import a SECOND processor module — one module each', () => {
    expect(fired.methodElementsSpecOtherProcessorModule).toContain(IMPORT_RULE);
  });

  it('NEGATIVE: a sanctioned file cannot reach mc/ or mc-view/ either', () => {
    expect(fired.methodElementsSpecMc).toContain(IMPORT_RULE);
    expect(fired.methodElementsSpecMcView).toContain(IMPORT_RULE);
  });

  it('POSITIVE: a deep relative import INSIDE the enabler stays legal', () => {
    expect(fired.insideEnabler).not.toContain(IMPORT_RULE);
  });
});
