import type { ApplicationWindow } from '@commercetools-frontend/constants';
import {
  buildTimeEntryPointUriPath,
  entryPointUriPath,
} from '../src/constants';

declare let window: ApplicationWindow;

/**
 * The build-time half of `src/constants.ts`. It runs in Node, inside
 * `custom-application-config.mjs`, and the value it resolves IS the authorization contract: the
 * entry point mints `canManage<TitleCase(this)>`, which the processor enforces as its brand
 * `managePermission`, and which the `mc-view` panel must present the matching permission group for.
 * A build that resolves a different one ships an application where every config mutation answers
 * 403, with nothing failing at build time.
 *
 * The resolver is exercised directly rather than through the module's `entryPointUriPath`: under
 * jsdom that constant takes the runtime `window.app` branch, which is the shell's injected value and
 * not this one.
 */

const withEnv = <T>(value: string | undefined, read: () => T): T => {
  const original = process.env.ENTRY_POINT_URI_PATH;
  if (value === undefined) delete process.env.ENTRY_POINT_URI_PATH;
  else process.env.ENTRY_POINT_URI_PATH = value;
  try {
    return read();
  } finally {
    if (original === undefined) delete process.env.ENTRY_POINT_URI_PATH;
    else process.env.ENTRY_POINT_URI_PATH = original;
  }
};

const resolved = (value: string | undefined): string =>
  withEnv(value, buildTimeEntryPointUriPath);

describe('the build-time entry point', () => {
  it('falls back to the value the processor expects when the deployment sets none', () => {
    expect(resolved(undefined)).toBe('unzer-payments');
  });

  it('uses the deployment value when one is configured', () => {
    expect(resolved('unzer-payments-eu')).toBe('unzer-payments-eu');
  });

  it('trims what the deployment field carries, so a trailing newline mints no permission', () => {
    expect(resolved(' unzer-payments\n')).toBe('unzer-payments');
  });

  it('treats a blank value as unset rather than as a configured empty entry point', () => {
    expect(resolved('   ')).toBe('unzer-payments');
  });

  /**
   * `connect validate` substitutes `build_template` for every declared key it does not assign. Read
   * as configured it would mint `canManageBuildTemplate` here, and in `mc-view` a permission group
   * name carrying an underscore, which the platform rejects outright.
   */
  it('treats the connect validate placeholder as unset', () => {
    expect(resolved('build_template')).toBe('unzer-payments');
  });

  /** In the browser the shell's injected path wins: the deployed app is the authority on its own path. */
  it('reads the shell-injected path at runtime, not the environment', () => {
    expect(entryPointUriPath).toBe(window.app.entryPointUriPath);
  });
});
