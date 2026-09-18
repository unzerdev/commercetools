import { PERMISSIONS, entryPointUriPath } from './src/constants';

/**
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomApplication}
 */

/**
 * The keys that decide where the built bundle is registered and what it is allowed to do: the Custom
 * Application id, the origin it is served from, and the entry point the permission the processor
 * enforces is derived from. A wrong value in any of them is not a build failure - it is a deployed
 * application that registers under a placeholder id, or that presents a permission the processor does
 * not accept.
 *
 * PROCESSOR_URL is deliberately NOT here: on Connect the processor URL is assigned after this bundle
 * is built, so a first install carries none and the value is filled in and deployed a second time.
 */
const DEPLOYMENT_KEYS = [
  'CUSTOM_APPLICATION_ID',
  'APPLICATION_URL',
  'ENTRY_POINT_URI_PATH',
];

/**
 * What `commercetools connect validate` substitutes for a declared standardConfiguration key when it
 * builds an application with no deployment behind it. It is a build placeholder, not a configured
 * value: treating it as one bakes `build_template` into the artifact, and into the permission the
 * `mc-view` panel must present for the processor to accept it.
 */
const VALIDATION_PLACEHOLDER = 'build_template';

/**
 * Set means "carries a value". A key present but blank is the ordinary way a value is parked for
 * later, and the guard below and the fallback must agree about it: if one read `''` as configured
 * and the other as unset, an all-blank `.env` would pass the guard and then emit `applicationId: ''`,
 * `url: ''` — an id and an origin that match nothing.
 */
const configured = (name) => {
  const value = (process.env[name] ?? '').trim();
  return value !== '' && value !== VALIDATION_PLACEHOLDER;
};

/**
 * The keys Connect assigns itself, with a real value, even when no deployment is behind the build. Not
 * declared in connect.yaml: the platform overrides a typed value anyway, so an install field would only mislead.
 */
const PLATFORM_ASSIGNED_KEYS = ['APPLICATION_URL'];

/**
 * A deployment is configured, or it is not, and the two are told apart by the PLACEHOLDER.
 *
 * `connect validate` builds every application with no deployment behind it, and that build is not
 * empty: Connect assigns the application its own URL and substitutes VALIDATION_PLACEHOLDER for every
 * key it does not assign. The placeholder is evidence only when it is the WHOLE story, so ALL of those
 * keys must carry it; then no deployment is behind this build and the fallbacks apply, which is what
 * lets a checkout with no `.env` validate at all - `${env:NAME}` aborted the build on the first
 * placeholder it could not resolve, which is how this application failed validation while `mc-view`,
 * already reading the environment itself, passed.
 *
 * Anything else that sets ANY deployment key is a real build for a real place and must set them all.
 * Three states are forbidden, and each was silent before this guard: an id injected with
 * APPLICATION_URL missing ships `url: 'https://localhost:3001'`; a real URL with the rest missing ships
 * a production origin beside a placeholder id; and one placeholder sitting beside real values is a
 * deployment with one key misconfigured, not a validation build. The first signal for any of them would
 * otherwise be an operator opening an application that registers as something else.
 */
const isValidationBuild = DEPLOYMENT_KEYS.filter(
  (key) => !PLATFORM_ASSIGNED_KEYS.includes(key)
).every((key) => (process.env[key] ?? '').trim() === VALIDATION_PLACEHOLDER);

const missingDeploymentKeys =
  !isValidationBuild && DEPLOYMENT_KEYS.some(configured)
    ? DEPLOYMENT_KEYS.filter((key) => !configured(key))
    : [];

if (missingDeploymentKeys.length > 0) {
  throw new Error(
    `mc: this build configures the deployment but does not set ${missingDeploymentKeys.join(
      ', '
    )}. ` +
      `Set every one of ${DEPLOYMENT_KEYS.join(
        ', '
      )} (mc/.env for a local build, the Connect ` +
      `deployment's configuration otherwise), or set none of them to build the unconfigured placeholders.`
  );
}

/**
 * Read an environment value, falling back to the placeholder `.env.template` documents. The value is
 * trimmed on the way out for the same reason `configured` trims to decide: a deployment field that
 * arrives with a trailing newline would otherwise pass the guard and be baked into the bundle with
 * the whitespace still on it - an id, or an origin, that matches nothing.
 */
const fromEnv = (name, fallback) =>
  configured(name) ? process.env[name].trim() : fallback;

/** Connect assigns APPLICATION_URL as a bare host, and the config is parsed with `new URL()`, so add the scheme. */
const asUrl = (value) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;

const config = {
  name: 'Unzer Payments',
  entryPointUriPath,
  cloudIdentifier: fromEnv('CLOUD_IDENTIFIER', 'gcp-eu'),
  env: {
    development: {
      // Development-only, and deliberately NOT a deployment key: it names the project a developer
      // opens the app against locally and is never declared in connect.yaml, so a validation build
      // has nothing to substitute for it.
      initialProjectKey: fromEnv('CTP_INITIAL_PROJECT_KEY', 'your-project-key'),
    },
    production: {
      applicationId: fromEnv('CUSTOM_APPLICATION_ID', '__local-development__'),
      url: asUrl(fromEnv('APPLICATION_URL', 'https://localhost:3001')),
    },
  },
  // The config UI reads the project's stores and reference-data settings; it never
  // manages orders or payments (those flows are owned by the processor over the
  // MC proxy), so no manage_orders/manage_payments scopes are requested.
  oAuthScopes: {
    view: ['view_stores', 'view_project_settings'],
    manage: [],
  },
  // The processor `/operations/*` base URL the UI forwards to via /proxy/forward-to. Blank on a first
  // install, where the processor has no URL yet.
  additionalEnv: {
    processorUrl: fromEnv('PROCESSOR_URL', ''),
  },
  // NO `csp` block, deliberately. The browser never connects to the processor origin: every call goes
  // to the MC API Gateway's `/proxy/forward-to`, which forwards server-side, so a `connect-src` naming
  // the processor would constrain nothing that happens. The one processor-origin resource this surface
  // could load is a payment-method logo, and that is `img-src`, whose Merchant Center default is
  // already `*` — the Merchant Center merges declared directives as a UNION with its own defaults, so
  // any value written here would widen to `*` while READING as a restriction that is in force.
  icon: '${path:@commercetools-frontend/assets/application-icons/rocket.svg}',
  mainMenuLink: {
    uriPath: 'unzer-payments',
    defaultLabel: 'Unzer Payments',
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },
};

export default config;
