/**
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomView}
 */

/**
 * The keys that decide where the built bundle is registered and what it is allowed to do: the Custom
 * View id, the origin it is served from, and the entry point the permission group is named after. A
 * wrong value in any of them is not a build failure — it is a deployed panel that registers under a
 * placeholder id, or that presents a permission the processor does not accept.
 *
 * PROCESSOR_URL is deliberately NOT here: on Connect the processor URL is assigned after this bundle
 * is built, so a first install carries none and the value is filled in and deployed a second time.
 */
const DEPLOYMENT_KEYS = [
  'CUSTOM_VIEW_ID',
  'APPLICATION_URL',
  'ENTRY_POINT_URI_PATH',
];

/**
 * What `commercetools connect validate` substitutes for a declared standardConfiguration key when it
 * builds an application with no deployment behind it. It is a build placeholder, not a configured
 * value: treating it as one bakes `build_template` into the artifact — and for the Custom View it is
 * fatal, because a permission group name admits lowercase letters and non-consecutive hyphens only,
 * so the platform rejects the underscore with a message about the group rather than about the key.
 */
const VALIDATION_PLACEHOLDER = 'build_template';

/**
 * Set means "carries a value". A key present but blank is the ordinary way a value is parked for
 * later, and the guard below and the fallback must agree about it: if one read `''` as configured
 * and the other as unset, an all-blank `.env` would pass the guard and then emit `customViewId: ''`,
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
 * lets a checkout with no `.env` validate at all — `${env:NAME}` would abort on the first placeholder.
 *
 * Anything else that sets ANY deployment key is a real build for a real place and must set them all.
 * Three states are forbidden, and each was silent before this guard: an id injected with
 * APPLICATION_URL missing ships `url: 'https://localhost:3001'`; a real URL with the rest missing ships
 * a production origin beside a placeholder id; and one placeholder sitting beside real values is a
 * deployment with one key misconfigured, not a validation build. The first signal for any of them
 * would otherwise be an operator opening a panel that registers as something else.
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
    `mc-view: this build configures the deployment but does not set ${missingDeploymentKeys.join(
      ', '
    )}. ` +
      `Set every one of ${DEPLOYMENT_KEYS.join(
        ', '
      )} (mc-view/.env for a local build, the Connect ` +
      `deployment's configuration otherwise), or set none of them to build the unconfigured placeholders.`
  );
}

/**
 * Read an environment value, falling back to the placeholder `.env.template` documents. The value is
 * trimmed on the way out for the same reason `configured` trims to decide: a deployment field that
 * arrives with a trailing newline would otherwise pass the guard and be baked into the bundle with
 * the whitespace still on it — an id, or an origin, that matches nothing.
 */
const fromEnv = (name, fallback) =>
  configured(name) ? process.env[name].trim() : fallback;

/** Connect assigns APPLICATION_URL as a bare host, and the config is parsed with `new URL()`, so add the scheme. */
const asUrl = (value) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;

// The mc config app's entry point. The processor gates every /operations/* route with
// `canManage<TitleCase(ENTRY_POINT_URI_PATH)>` (its brand `managePermission`,
// `canManageUnzerPayments`), so the additional permission group below must be named after the SAME
// value to mint the matching permission. The fallback mirrors `mc/src/constants.ts`, which is what
// makes an unconfigured local build of the two applications agree.
const entryPointUriPath = fromEnv('ENTRY_POINT_URI_PATH', 'unzer-payments');

const config = {
  name: 'Unzer ASB',
  description: 'Payment extension',
  cloudIdentifier: fromEnv('CLOUD_IDENTIFIER', 'gcp-eu'),
  env: {
    development: {
      initialProjectKey: fromEnv('CTP_INITIAL_PROJECT_KEY', 'your-project-key'),
      hostUriPath:
        '/my-project-uat/orders/98fec4d2-c0d2-42ab-a276-338023b1f700/payments',
    },
    production: {
      customViewId: fromEnv('CUSTOM_VIEW_ID', '__local-development__'),
      url: asUrl(fromEnv('APPLICATION_URL', 'https://localhost:3001')),
    },
  },
  // Least privilege: the panel calls neither commercetools nor the PSP — everything it reads comes from the
  // processor over `/proxy/forward-to`. It needs only the read scope of the resource it is mounted on, and
  // no write scope at all; a `manage_*` here would be a standing grant on the project for nothing.
  oAuthScopes: {
    view: ['view_orders'],
    manage: [],
  },
  // A Custom View's DEFAULT permission is the bare `canManage`, which never matches the processor's
  // required `canManage<TitleCase(ENTRY_POINT_URI_PATH)>`. An additional permission group named after the
  // entry point mints `canManage<PascalCase(name)>` (e.g. `psp-payments` -> `canManagePspPayments`),
  // the permission the operator must hold for the panel's forward-to reads/actions to pass the processor's
  // `requireManagePermission` gate.
  //
  // BOTH sides carry a scope, and the manage side is the one that is easy to get wrong. The panel calls
  // neither commercetools nor the vendor - every write goes through the processor, under the CONNECTOR's
  // own credentials - so on paper the group needs no manage scope at all. But a group whose manage side is
  // EMPTY is registered and then never materialized as a granted permission: the operator ends up holding
  // only the view's default `canManage`, the processor's gate sees exactly that, and every read, capture,
  // refund and cancel answers 403 with nothing in the Merchant Center looking wrong. So the manage side
  // carries one scope, deliberately the narrowest that matches the resource the panel is mounted on.
  additionalOAuthScopes: [
    {
      name: entryPointUriPath,
      view: ['view_orders'],
      manage: ['manage_orders'],
    },
  ],
  // The processor `/operations/*` base URL the panel forwards to via /proxy/forward-to. Blank on a
  // first install, where the processor has no URL yet.
  additionalEnv: {
    processorUrl: fromEnv('PROCESSOR_URL', ''),
  },
  // NO `csp` block, deliberately. The browser never connects to the processor origin: every call goes
  // to the MC API Gateway's `/proxy/forward-to`, which forwards server-side, so a `connect-src` naming
  // the processor would constrain nothing that happens. The one processor-origin resource this panel
  // loads is a payment-method logo, and that is `img-src`, whose Merchant Center default is already
  // `*` — a declared directive is merged as a UNION with that default, so any value written here would
  // widen to `*` while READING as a restriction that is in force.
  type: 'CustomPanel',
  typeSettings: {
    size: 'LARGE',
  },
  locators: ['orders.order_details.payments'],
};

export default config;
