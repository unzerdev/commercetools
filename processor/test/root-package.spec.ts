/**
 * The repository root's `package.json` carries lint-staged config and nothing else - the four applications
 * are standalone, with no npm workspaces - yet two of its fields decide whether CI can run at all. Nothing
 * else in the repository reads them, so only a check here can catch a regression, and one of them has
 * regressed twice already.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT_PACKAGE = path.join(__dirname, '..', '..', 'package.json');

const APPS = ['processor', 'enabler', 'mc', 'mc-view', 'e2e'] as const;

/** The repository root's manifest, parsed. */
const rootPackage = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf8')) as Record<string, unknown>;

describe('the repository root package.json', () => {
  /**
   * `actions/setup-node` reads `packageManager` to decide which package manager to cache for, and a yarn
   * value sends it looking for a `yarn.lock` at the repository root. This repository is npm - each
   * application carries its own `package-lock.json` and CI runs `npm ci` - so there is no such file, and
   * the step fails with "Dependencies lock file is not found" BEFORE any gate command runs. Every job in
   * `.github/workflows/ci.yml` dies at once, which reads as a broken repository rather than as one wrong
   * field. The field has been removed twice already; this is the check that makes a third time fail here
   * instead of on the runner.
   */
  it('declares no packageManager - setup-node would look for a yarn.lock this repository does not have', () => {
    expect(rootPackage().packageManager).toBeUndefined();
  });

  /** No yarn lockfile may appear either, at the root or in any application: the same step reads them. */
  it('carries no yarn.lock at the root or in any application', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const candidates = ['', ...APPS].map((app) => path.join(repoRoot, app, 'yarn.lock'));

    expect(candidates.filter((candidate) => fs.existsSync(candidate))).toEqual([]);
  });

  /**
   * The release tag and every package version move together. The root is the one manifest no application's
   * own gate would ever read, so a bump that misses it is invisible until a release names the wrong version.
   */
  it('carries the same version as every application', () => {
    const versions = APPS.map((app) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', app, 'package.json'), 'utf8')) as {
        version: string;
      };
      return [app, manifest.version] as const;
    });

    expect(Object.fromEntries(versions)).toEqual(Object.fromEntries(APPS.map((app) => [app, rootPackage().version])));
  });
});
