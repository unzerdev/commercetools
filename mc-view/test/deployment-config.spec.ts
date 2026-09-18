/**
 * The Custom View config decides where the built bundle is registered and what it may talk to:
 * `customViewId`, the production `url`, the optional `externalApiUrl` override and the permission
 * group the panel presents. Those come from the environment, and `.env` is gitignored — so
 * `commercetools connect validate`, which checks out the repository and builds with no `.env` at
 * all, must still get through.
 *
 * The two are told apart by the PLACEHOLDER, not by which keys happen to be set: the validation
 * build carries `build_template` in every declared key the platform does not assign itself, and
 * nothing else ever does. Anything else that sets a deployment key is a real build for a real place
 * and must set them all.
 *
 * What that forbids is either half-configured artifact: an id and an API URL with `APPLICATION_URL`
 * missing, which ships a panel pointing at `https://localhost:3001`, and a real production URL with
 * the rest missing, which ships that origin beside a placeholder id and a localhost CSP.
 */

const DEPLOYMENT_ENV = {
  CUSTOM_VIEW_ID: 'ckvv1t5kk000abcdefghijklm',
  APPLICATION_URL: 'https://unzer-payments-view.example.com',
  PROCESSOR_URL: 'https://processor.example.com',
  ENTRY_POINT_URI_PATH: 'unzer-payments',
};

/** Load the config module fresh under `env`, so its import-time resolution runs against it. */
const loadConfig = (env: Record<string, string | undefined>) => {
  const original = process.env;
  process.env = { ...original, ...env } as NodeJS.ProcessEnv;
  try {
    jest.resetModules();
    return require('../custom-view-config').default;
  } finally {
    process.env = original;
  }
};

const withoutDeploymentKeys = {
  CUSTOM_VIEW_ID: undefined,
  APPLICATION_URL: undefined,
  PROCESSOR_URL: undefined,
  ENTRY_POINT_URI_PATH: undefined,
};

describe('the Custom View deployment config', () => {
  it('builds on placeholders when nothing is configured, so a bare checkout validates', () => {
    const config = loadConfig(withoutDeploymentKeys);

    expect(config.env.production.customViewId).toBe('__local-development__');
    expect(config.env.production.url).toBe('https://localhost:3001');
    // Blank, not localhost: an unset override is the signal to read the descriptor the processor
    // publishes in its post-deploy, which is the only source on Connect.
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  it('uses every configured value when the deployment supplies them all', () => {
    const config = loadConfig(DEPLOYMENT_ENV);

    expect(config.env.production.customViewId).toBe(
      DEPLOYMENT_ENV.CUSTOM_VIEW_ID
    );
    expect(config.env.production.url).toBe(DEPLOYMENT_ENV.APPLICATION_URL);
    expect(config.additionalEnv.processorUrl).toBe(
      DEPLOYMENT_ENV.PROCESSOR_URL
    );
    // No CSP block at all: the browser never connects to the processor origin (every call goes to the
    // gateway's /proxy/forward-to), so a `connect-src` naming it would constrain nothing.
    expect(config.headers).toBeUndefined();
  });

  /**
   * Connect assigns this key as a BARE HOST, with no scheme, and the Merchant Center config layer
   * parses the value with `new URL()` - which threw `Invalid application URL` on the assigned value
   * and failed the install. The scheme is added when it is missing, and left alone when it is not.
   */
  it('adds the scheme Connect omits from the assigned application URL', () => {
    const config = loadConfig({
      ...DEPLOYMENT_ENV,
      APPLICATION_URL: 'mc-view.example.com',
    });

    expect(config.env.production.url).toBe('https://mc-view.example.com');
    expect(() => new URL(config.env.production.url)).not.toThrow();
  });

  it('leaves an application URL that already carries a scheme untouched', () => {
    const config = loadConfig({
      ...DEPLOYMENT_ENV,
      APPLICATION_URL: 'http://localhost:3001',
    });

    expect(config.env.production.url).toBe('http://localhost:3001');
  });

  it('refuses to build when a configured deployment omits APPLICATION_URL', () => {
    expect(() =>
      loadConfig({ ...DEPLOYMENT_ENV, APPLICATION_URL: undefined })
    ).toThrow(/APPLICATION_URL/);
  });

  it('names every missing key, not just the first', () => {
    expect(() =>
      loadConfig({
        ...DEPLOYMENT_ENV,
        APPLICATION_URL: undefined,
        CUSTOM_VIEW_ID: undefined,
      })
    ).toThrow(
      /APPLICATION_URL.*CUSTOM_VIEW_ID|CUSTOM_VIEW_ID.*APPLICATION_URL/
    );
  });

  it('builds a configured deployment that omits PROCESSOR_URL, which is no longer a deployment key', () => {
    const config = loadConfig({
      ...DEPLOYMENT_ENV,
      PROCESSOR_URL: undefined,
    });

    expect(config.env.production.customViewId).toBe(
      DEPLOYMENT_ENV.CUSTOM_VIEW_ID
    );
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  /**
   * The permission group's name IS the authorization contract. It mints
   * `canManage<PascalCase(name)>`, and the processor's `requireManagePermission` checks the brand's
   * `managePermission` — `canManageUnzerPayments`. A build that resolves a different entry point
   * produces a panel where every forward-to read answers 403, with nothing failing at build time.
   */
  it('mints the permission group from the same entry point the mc app defaults to', () => {
    const config = loadConfig(withoutDeploymentKeys);

    expect(config.additionalOAuthScopes[0].name).toBe('unzer-payments');
  });

  it('refuses to build when a configured deployment omits ENTRY_POINT_URI_PATH', () => {
    expect(() =>
      loadConfig({ ...DEPLOYMENT_ENV, ENTRY_POINT_URI_PATH: undefined })
    ).toThrow(/ENTRY_POINT_URI_PATH/);
  });

  /**
   * A key present but blank is the ordinary way a developer parks a value. The guard's "is anything
   * configured?" test and the fallback must read it the same way, or the one in-between state the
   * guard exists to forbid becomes reachable through it.
   */
  it('treats blank values as unset rather than as a configured deployment', () => {
    const config = loadConfig({
      CUSTOM_VIEW_ID: '',
      APPLICATION_URL: '',
      PROCESSOR_URL: '',
      ENTRY_POINT_URI_PATH: '',
    });

    expect(config.env.production.customViewId).toBe('__local-development__');
    expect(config.env.production.url).toBe('https://localhost:3001');
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  /**
   * `connect validate` substitutes `build_template` for every declared standardConfiguration key
   * when it builds with no deployment behind it. Read as configured it is baked into the artifact,
   * and in the Custom View it is fatal: a permission group name admits no underscore, so the
   * platform rejects the build with a message about the group rather than about the key.
   */
  it('treats the connect validate placeholder as unset', () => {
    const config = loadConfig({
      CUSTOM_VIEW_ID: 'build_template',
      APPLICATION_URL: 'build_template',
      PROCESSOR_URL: 'build_template',
      ENTRY_POINT_URI_PATH: 'build_template',
    });

    expect(config.env.production.customViewId).toBe('__local-development__');
    expect(config.env.production.url).toBe('https://localhost:3001');
    // The one the platform actually rejects: `build_template` carries an underscore.
    expect(config.additionalOAuthScopes[0].name).toBe('unzer-payments');
  });

  /**
   * What the validation build actually looks like, and why the placeholder is the evidence rather
   * than the set of keys: Connect assigns the application its URL even with no deployment behind it,
   * and substitutes the placeholder for everything else. Deciding on which keys are set cannot tell
   * this apart from a deployment missing three of them — the case below is that shape, and it must
   * fail while this one builds.
   */
  it('builds the placeholders when only the platform-assigned URL is present', () => {
    const config = loadConfig({
      CUSTOM_VIEW_ID: 'build_template',
      APPLICATION_URL: 'https://mc-abc123.europe-west1.gcp.commercetools.app',
      PROCESSOR_URL: 'build_template',
      ENTRY_POINT_URI_PATH: 'build_template',
    });

    expect(config.env.production.customViewId).toBe('__local-development__');
    expect(config.additionalEnv.processorUrl).toBe('');
    // The one field that is NOT a placeholder here: the platform's own assignment is used as given.
    expect(config.env.production.url).toBe(
      'https://mc-abc123.europe-west1.gcp.commercetools.app'
    );
  });

  /**
   * The mirror of the case above, and the reason the two are told apart by the PLACEHOLDER rather
   * than by which key is set. A build carrying only a real URL is not a validation build — it is a
   * deployment missing three keys, and it must fail rather than emit the mixed artifact: a real
   * production origin beside a placeholder id and a localhost CSP.
   */
  it('refuses a build that carries a real URL and nothing else', () => {
    expect(() =>
      loadConfig({
        CUSTOM_VIEW_ID: undefined,
        APPLICATION_URL: 'https://real.example.com',
        PROCESSOR_URL: undefined,
        ENTRY_POINT_URI_PATH: undefined,
      })
    ).toThrow(/CUSTOM_VIEW_ID/);
  });

  /**
   * The placeholder is evidence only when it is the WHOLE story. Connect substitutes it for every
   * declared key it does not assign itself, so a build carrying it in one key beside real values is
   * not a validation build — it is a deployment with one key misconfigured, and reading it as a
   * validation build would disable the guard for the other three and ship the mixed artifact.
   */
  it('refuses a build carrying the placeholder in one key beside real values', () => {
    expect(() =>
      loadConfig({
        CUSTOM_VIEW_ID: 'build_template',
        APPLICATION_URL: 'https://real.example.com',
        PROCESSOR_URL: 'https://processor.example.com',
        ENTRY_POINT_URI_PATH: 'unzer-payments',
      })
    ).toThrow(/CUSTOM_VIEW_ID/);
  });

  it('trims a padded value rather than baking the whitespace into the bundle', () => {
    const config = loadConfig({
      ...DEPLOYMENT_ENV,
      APPLICATION_URL: '  https://unzer-payments-view.example.com  ',
    });

    expect(config.env.production.url).toBe(
      'https://unzer-payments-view.example.com'
    );
  });

  it('names a blank key as missing when the rest of the deployment is configured', () => {
    expect(() =>
      loadConfig({ ...DEPLOYMENT_ENV, APPLICATION_URL: '   ' })
    ).toThrow(/APPLICATION_URL/);
  });
});
