/**
 * The vendor is reached from ONE place: `providers/psp/client/transport.ts`.
 *
 * That funnel owns the base URL, the Basic auth built from the private key, the money-safety deadline
 * and the `PspError` mapping. A second `fetch` anywhere in the provider would be a second set of those
 * decisions - one without a timeout, or one whose error body escapes raw.
 *
 * Two exceptions are NAMED rather than tolerated silently:
 * - `gateway.ts`'s default webhook transport, which posts the simulator's own loopback event, and
 * - the browser `fetch`es inside `routes.ts` HTML templates, which run in the shopper's page, not here.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

const PROVIDER = path.join(process.cwd(), 'src/providers/psp');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });

/** Every provider `.ts` file, as `{ relative path, source }`. */
const providerFiles = (): { file: string; source: string }[] =>
  walk(PROVIDER).map((full) => ({
    file: path.relative(PROVIDER, full).split(path.sep).join('/'),
    source: fs.readFileSync(full, 'utf8'),
  }));

/**
 * Strip template literals before counting: a provider module may EMBED page source that calls `fetch`
 * in the shopper's browser. That is page source, not connector transport.
 */
const withoutTemplates = (source: string): string => source.replace(/`[\s\S]*?`/g, '``');

const THE_FUNNEL = 'client/transport.ts';

describe('the vendor transport funnel is the only place the provider calls out', () => {
  it('no provider module performs its own fetch', () => {
    const offenders = providerFiles()
      .filter(({ file }) => file !== THE_FUNNEL)
      // A GLOBAL `fetch(` INVOCATION - not a resource METHOD named `fetch` (`client.customers.fetch(…)`
      // and its declaration), which the customers/types resources legitimately expose. Every real call
      // in this codebase awaits the promise, so the await is the invocation's signature.
      .filter(({ source }) => /await\s+fetch\(|globalThis\.fetch\s*\(/.test(withoutTemplates(source)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('the funnel still holds the deadline and the typed-error mapping', () => {
    const funnel = fs.readFileSync(path.join(PROVIDER, THE_FUNNEL), 'utf8');

    expect(funnel).toContain('cfg.requestTimeoutMs');
    expect(funnel).toContain('PspError.timedOut');
    expect(funnel).toContain('PspError.fromTransport');
    expect(funnel).toContain('PspError.fromErrorResponse');
  });

  it('every vendor call takes a named request object, never a loose argument list', () => {
    const transport = fs.readFileSync(path.join(PROVIDER, THE_FUNNEL), 'utf8');

    // The funnel's own signature is the guarantee: a resource cannot pass `(method, path, body)`
    // positionally, so a new resource inherits the convention rather than re-deciding it. The request may
    // be destructured or taken whole - what is pinned is that it is ONE named object and nothing else.
    expect(transport).toMatch(
      /send\(cfg: PspConnectionConfig, (?:request|\{ method, path, body, idempotencyKey \}): PspRequest\)/,
    );
  });
});
