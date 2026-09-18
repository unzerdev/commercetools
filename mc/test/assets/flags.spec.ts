/**
 * The generated flag index must stay in step with the artwork folder beside it.
 *
 * `flags.ts` is written by hand-run codegen: one `import` per `country-<alpha2>.svg` and one entry per
 * import. Nothing about the language selector or the country list fails loudly when the two drift — a
 * missing entry is a silently flagless row, in a list the operator reads BY the flag — so the drift is
 * what this asserts, in both directions, the way `method-catalogue.spec` does for the method logos.
 *
 * The imports resolve to jest's file stub rather than a `data:` URL (the preset maps every asset
 * extension), so the VALUES are only asserted to be present; what they carry is the build's business.
 */
import fs from 'fs';
import path from 'path';
import { flags } from '../../src/assets/flags';

const FLAGS_DIR = path.join(__dirname, '../../src/assets/images/flags');
const COUNTRY_FILE = /^country-([a-z]{2})\.svg$/;

const artwork = fs.readdirSync(FLAGS_DIR);

describe('assets/flags index', () => {
  it('has an entry for every country-<alpha2>.svg in the folder', () => {
    const missing = artwork
      .map((file) => COUNTRY_FILE.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, code]) => code.toUpperCase())
      .filter((code) => !flags[code]);

    expect(missing).toEqual([]);
  });

  it('keys every entry by an uppercase ISO-3166 alpha-2 code', () => {
    for (const code of Object.keys(flags)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(flags[code]).toBeTruthy();
    }
  });

  it('imports no artwork that is not in the folder', () => {
    // The reverse drift: an entry whose file was renamed or deleted. A stale import breaks the BUILD,
    // but only once someone builds; this says so on the next test run.
    const files = new Set(artwork);
    const orphans = Object.keys(flags).filter(
      (code) => !files.has(`country-${code.toLowerCase()}.svg`)
    );

    expect(orphans).toEqual([]);
  });

  it('covers the whole folder: every file in it is an addressable country', () => {
    // Nothing may sit in the folder that no ISO-3166 alpha-2 code can look up (the three such files the
    // artwork shipped with — Ascension, Tristan da Cunha, the UN flag — were removed for this reason).
    const unaddressable = artwork.filter((file) => !COUNTRY_FILE.test(file));

    expect(unaddressable).toEqual([]);
  });
});
