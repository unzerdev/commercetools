/**
 * commercetools is reached from ONE place: `infrastructure/commercetools/`.
 *
 * `paymentSDK` is constructed once in `bootstrap/payment-sdk.ts` and consumed only by that folder,
 * which exposes `ctClient` (the raw resources), `ctServices` (the SDK facades) and `ctAuthHooks`. Every
 * adapter, repository and HTTP plugin goes through it, so "how the connector talks to commercetools"
 * has a single address - and changing it is one folder, not a grep.
 *
 * This reads source text (like `architecture-http-surfaces.spec.ts`) because the rule is about what a
 * reader can trust at a glance: running code would only prove it for the paths a test happens to hit.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

const SRC = path.join(process.cwd(), 'src');

/** Every `.ts` file under `src`, as `{ relative path, source }`. */
const sourceFiles = (): { file: string; source: string }[] => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });

  return walk(SRC).map((full) => ({
    file: path.relative(SRC, full).split(path.sep).join('/'),
    source: fs.readFileSync(full, 'utf8'),
  }));
};

/** The two modules allowed to name `paymentSDK`: the seam, and the bootstrap that builds it. */
const ALLOWED = (file: string): boolean =>
  file.startsWith('infrastructure/commercetools/') || file === 'infrastructure/bootstrap/payment-sdk.ts';

describe('the commercetools client is the one commercetools seam', () => {
  it('nothing outside infrastructure/commercetools names paymentSDK', () => {
    // The identifier, not the module: `bootstrap/payment-sdk` also exports the app logger, which the
    // composition root legitimately reads. `paymentSDK` followed by `.`, `,` or `}` catches every use
    // and every import specifier, while leaving prose that merely mentions it in backticks alone.
    const offenders = sourceFiles()
      .filter(({ file }) => !ALLOWED(file))
      .filter(({ source }) => /\bpaymentSDK\s*[.,}]/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('no adapter or repository builds its own commercetools request chain', () => {
    // `ctAPI.client` is the raw apiRoot: the `.customObjects()` / `.payments()` / `.stores()` builder
    // chains belong to the seam, and a call site that reaches for one has bypassed it.
    const offenders = sourceFiles()
      .filter(({ file }) => !ALLOWED(file))
      .filter(({ source }) => source.includes('ctAPI.client'))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('the seam is the only importer of the SDK service facades', () => {
    // `ctCartService` & co. are the SDK's own facades. They travel out of the seam as `ctServices`, so a
    // second reader of `paymentSDK.ct*Service` would be a second definition of the connector's wiring.
    const facades = ['ctCartService', 'ctPaymentService', 'ctPaymentMethodService', 'ctCustomTypeService'];
    const offenders = sourceFiles()
      .filter(({ file }) => !ALLOWED(file))
      .filter(({ source }) => facades.some((facade) => source.includes(`paymentSDK.${facade}`)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
