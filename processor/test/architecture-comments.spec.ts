/**
 * The comment guard: no reference to a plan, a decision record, a learning log, a spec or acceptance tag,
 * or a docs path may live in the code.
 *
 * The reason is that those references rot invisibly. A comment naming `ADR-150` or `spec D8` is a promise
 * that the reader can go and find it, and the document it points at is renamed, renumbered or deleted on
 * its own schedule - after which the comment says nothing except that someone once decided something. The
 * REASON belongs inline, in the sentence itself, where it cannot drift from the code it explains.
 *
 * This scans the processor's own source and tests. The other applications are held by their own reviews;
 * this is the gate that keeps the rule from regressing where the bulk of the code is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOTS = ['src', 'test'];

/** One forbidden shape, with the reason it is forbidden - the message a failure prints. */
interface ForbiddenReference {
  label: string;
  pattern: RegExp;
}

const FORBIDDEN: readonly ForbiddenReference[] = [
  { label: 'an ADR / decision-record number', pattern: /\bADR-\d+/ },
  { label: 'the decisions or learnings logs', pattern: /\b(?:DECISIONS|LEARNINGS)\b/ },
  { label: 'a plan or spec section', pattern: /\b(?:plan|spec|DESIGN)\s*§/ },
  { label: 'a bare section sign reference', pattern: /§\d/ },
  { label: 'a spec decision tag', pattern: /\bspec\s+D\d+/ },
  { label: 'a spec clause number', pattern: /\bspec\s+\d+\./ },
  { label: 'an acceptance-criteria tag', pattern: /\bAC\d+\b/ },
  { label: 'an acceptance-criteria number', pattern: /\bacceptance\s+\d/ },
  { label: 'a parenthesised decision or task tag', pattern: /\((?:D|P|T|W|R|S)\d+(?:\s*[/,]\s*(?:D|P|T|W|R|S)\d+)*\)/ },
  { label: 'a leading task tag', pattern: /^\s*\*\s*(?:T|W|C)\d+\s*[-–—]/m },
  { label: 'a risk-register tag', pattern: /\bRisk\s+R\d+/ },
  { label: 'a code-review or security-review tag', pattern: /\b(?:CR-[HML]\d+|SEC-[ML]\d+)\b/ },
  { label: 'an issue number', pattern: /\bissue\s+#\d+/ },
  { label: 'a docs path', pattern: /\bdocs\/[A-Za-z0-9._-]+\.md/ },
];

/** Every `.ts` file under the scanned roots, so a new directory cannot slip past the guard. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? sourceFiles(full) : item.name.endsWith('.ts') ? [full] : [];
  });
}

/** This file is the one that must spell the forbidden shapes out, so it scans everything but itself. */
const files = ROOTS.flatMap((root) => sourceFiles(path.join(__dirname, '..', root))).filter(
  (file) => file !== __filename.replace(/\.js$/, '.ts'),
);

describe('the code carries no reference to a plan, a decision, a spec tag or a docs path', () => {
  it('scans a non-empty set of files, so a broken root cannot make the guard vacuous', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it.each(FORBIDDEN.map((forbidden) => [forbidden.label, forbidden] as const))('carries no %s', (_label, forbidden) => {
    const hits = files.flatMap((file) => {
      const relative = path.relative(path.join(__dirname, '..'), file);
      return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${relative}:${index + 1}` }))
        .filter(({ line }) => forbidden.pattern.test(line))
        .map(({ line, at }) => `${at}: ${line.trim()}`);
    });

    expect(hits).toEqual([]);
  });
});
