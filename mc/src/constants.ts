// Make sure to import the helper functions from the `ssr` entry point.
import { entryPointUriPathToPermissionKeys } from '@commercetools-frontend/application-shell/ssr';
import type { ApplicationWindow } from '@commercetools-frontend/constants';

declare let window: ApplicationWindow;

// At build time (Node, custom-application-config.mjs) the path comes from the
// deployment env with a dev default; at runtime the shell injects the deployed
// path via `window.app`, so the permission keys below always match the live entry point.
// `process.env` is read ONLY inside this function, which the ternary calls solely on the Node
// branch: the access is deferred so it is never evaluated in the browser bundle, where `process`
// is undefined (mc-scripts injects runtime config through `window.app`, not a `process` shim).
// `connect validate` builds with no deployment behind it and substitutes `build_template` for every
// declared key it does not assign, so that value is a build placeholder and not a configured entry
// point: read as one it would mint `canManageBuildTemplate` here and, in `mc-view`, a permission
// group name carrying an underscore that the platform rejects outright. A blank value is unset for
// the same reason `custom-application-config.mjs` trims before deciding.
export const buildTimeEntryPointUriPath = (): string => {
  const configured = (process.env.ENTRY_POINT_URI_PATH ?? '').trim();
  return configured === '' || configured === 'build_template'
    ? 'unzer-payments'
    : configured;
};

export const entryPointUriPath =
  typeof window === 'undefined'
    ? buildTimeEntryPointUriPath()
    : window.app.entryPointUriPath;

export const PERMISSIONS = entryPointUriPathToPermissionKeys(entryPointUriPath);
