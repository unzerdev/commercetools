/**
 * Architecture-boundary guard. Proves the ring enforcement in `eslint.config.mjs` actually
 * BITES: the `import-x/no-restricted-paths` zones are linted here through the programmatic ESLint API
 * against synthetic snippets placed at real ring file paths, and we assert the rule fires (or stays
 * silent) per the onion dependency direction:
 *
 *   domain (innermost, pure) ← application (domain only)
 *   ← infrastructure / providers (providers may reach only application/{ports,handlers} + domain)
 *
 * The rule matches on the RESOLVED import path, so each probe imports a real existing module at the
 * correct relative depth and the `filePath` is an absolute `.ts` path under the ring being tested.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// ESLint init + config resolution is slow; give every case generous head-room.
jest.setTimeout(30000);

const RING_RULE = 'import-x/no-restricted-paths';

/**
 * The programmatic `ESLint` API resolves the repo's flat `eslint.config.mjs`, whose loader uses a
 * dynamic `import()`. Jest's CommonJS VM forbids that (`A dynamic import callback was invoked without
 * --experimental-vm-modules`), so the ESLint API is driven in a clean child Node process — it still
 * lints the REAL `eslint.config.mjs` (cwd = repo root) via `ESLint.lintText`, just outside jest's
 * ESM-restricted sandbox. The child prints the fired rule ids as JSON.
 */
const PROBE = `
const { ESLint } = require('eslint');
(async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [res] = await eslint.lintText(process.argv[1], { filePath: process.argv[2] });
  process.stdout.write(JSON.stringify(res.messages.map((m) => m.ruleId || '')));
})();
`;

/** Lint `code` as if it lived at `relFilePath` (under src/<ring>/) and return the rule ids that fired. */
function ruleIds(code: string, relFilePath: string): string[] {
  const filePath = path.join(process.cwd(), relFilePath);
  const out = execFileSync(process.execPath, ['-e', PROBE, code, filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return JSON.parse(out) as string[];
}

describe('architecture ring boundaries (import-x/no-restricted-paths)', () => {
  it('NEGATIVE: domain/ importing infrastructure/ is a ring violation', () => {
    const ids = ruleIds(
      "import { getConfig } from '../infrastructure/config/config';\nexport const x = getConfig;\n",
      'src/domain/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: application/ importing infrastructure/ is a ring violation', () => {
    const ids = ruleIds(
      "import { getConfig } from '../infrastructure/config/config';\nexport const x = getConfig;\n",
      'src/application/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: domain/ importing application/ is a ring violation', () => {
    const ids = ruleIds(
      "import { uploadLogo } from '../application/orchestration';\nexport const x = uploadLogo;\n",
      'src/domain/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: a TYPE-ONLY cross-ring import still trips the rule (boundary covers `import type`)', () => {
    const ids = ruleIds(
      "import type { getConfig } from '../infrastructure/config/config';\nexport type X = typeof getConfig;\n",
      'src/application/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: a provider importing infrastructure/ is a ring violation', () => {
    const ids = ruleIds(
      "import { getConfig } from '../../infrastructure/config/config';\nexport const x = getConfig;\n",
      'src/providers/psp/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: a provider importing application/orchestration is a ring violation', () => {
    const ids = ruleIds(
      "import { uploadLogo } from '../../application/orchestration';\nexport const x = uploadLogo;\n",
      'src/providers/psp/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: application/ importing a provider is a ring violation (core stays vendor-blind)', () => {
    const ids = ruleIds(
      "import { PspConfigHandler } from '../providers/psp/config/config.handler';\nexport const x = PspConfigHandler;\n",
      'src/application/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('NEGATIVE: infrastructure/ importing a provider is a ring violation', () => {
    const ids = ruleIds(
      "import { PspConfigHandler } from '../providers/psp/config/config.handler';\nexport const x = PspConfigHandler;\n",
      'src/infrastructure/__probe__.ts',
    );
    expect(ids).toContain(RING_RULE);
  });

  it('POSITIVE: a provider importing application/handlers is allowed', () => {
    const ids = ruleIds(
      "import type { ProviderModule } from '../../application/handlers';\nexport const x: ProviderModule | null = null;\n",
      'src/providers/psp/__probe__.ts',
    );
    expect(ids).not.toContain(RING_RULE);
  });

  it('POSITIVE: a provider importing domain/contracts is allowed', () => {
    const ids = ruleIds(
      "import type { StoreConfig } from '../../domain';\nexport const x: StoreConfig | null = null;\n",
      'src/providers/psp/__probe__.ts',
    );
    expect(ids).not.toContain(RING_RULE);
  });
});
