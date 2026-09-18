/**
 * The Custom Application config decides where the built bundle is registered and what it may talk
 * to: `applicationId`, the production `url`, the optional `processorUrl` override and the entry
 * point the processor's manage permission is derived from. Those come from the environment, and
 * `.env` is gitignored - so `commercetools connect validate`, which checks out the repository and
 * builds with no `.env` at all, must still get through. It did not: the config declared
 * `${env:CTP_INITIAL_PROJECT_KEY}`, a key connect.yaml does not declare and a validation build
 * therefore cannot substitute, and the build aborted while compiling `index.html`.
 *
 * The two are told apart by the PLACEHOLDER, not by which keys happen to be set: the validation
 * build carries `build_template` in every declared key the platform does not assign itself, and
 * nothing else ever does. Anything else that sets a deployment key is a real build for a real place
 * and must set them all.
 */

const DEPLOYMENT_ENV = {
  CUSTOM_APPLICATION_ID: 'ckvv1t5kk000abcdefghijklm',
  APPLICATION_URL: 'https://unzer-payments.example.com',
  PROCESSOR_URL: 'https://processor.example.com',
  ENTRY_POINT_URI_PATH: 'unzer-payments',
};

/** Load the config module fresh under `env`, so its import-time resolution runs against it. */
const loadConfig = (env: Record<string, string | undefined>) => {
  const original = process.env;
  process.env = { ...original, ...env } as NodeJS.ProcessEnv;
  try {
    jest.resetModules();
    return require('../custom-application-config').default;
  } finally {
    process.env = original;
  }
};

const withoutDeploymentKeys = {
  CUSTOM_APPLICATION_ID: undefined,
  APPLICATION_URL: undefined,
  PROCESSOR_URL: undefined,
  ENTRY_POINT_URI_PATH: undefined,
  CTP_INITIAL_PROJECT_KEY: undefined,
  CLOUD_IDENTIFIER: undefined,
};

describe('the Custom Application deployment config', () => {
  it('builds on placeholders when nothing is configured, so a bare checkout validates', () => {
    const config = loadConfig(withoutDeploymentKeys);

    expect(config.env.production.applicationId).toBe('__local-development__');
    expect(config.env.production.url).toBe('https://localhost:3001');
    expect(config.additionalEnv.processorUrl).toBe('');
    expect(config.cloudIdentifier).toBe('gcp-eu');
  });

  /**
   * The key that failed the validation build. It is development-only and connect.yaml declares no
   * such deployment field, so the config must supply the fallback itself rather than name a
   * placeholder nothing will ever substitute.
   */
  it('resolves the development project key without a deployment declaring it', () => {
    const config = loadConfig(withoutDeploymentKeys);

    expect(config.env.development.initialProjectKey).toBe('your-project-key');
  });

  it('uses every configured value when the deployment supplies them all', () => {
    const config = loadConfig(DEPLOYMENT_ENV);

    expect(config.env.production.applicationId).toBe(
      DEPLOYMENT_ENV.CUSTOM_APPLICATION_ID
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
      APPLICATION_URL: 'mc-app.example.com',
    });

    expect(config.env.production.url).toBe('https://mc-app.example.com');
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
        CUSTOM_APPLICATION_ID: undefined,
      })
    ).toThrow(
      /APPLICATION_URL.*CUSTOM_APPLICATION_ID|CUSTOM_APPLICATION_ID.*APPLICATION_URL/
    );
  });

  it('builds a configured deployment that omits PROCESSOR_URL, which is no longer a deployment key', () => {
    const config = loadConfig({
      ...DEPLOYMENT_ENV,
      PROCESSOR_URL: undefined,
    });

    expect(config.env.production.applicationId).toBe(
      DEPLOYMENT_ENV.CUSTOM_APPLICATION_ID
    );
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  /**
   * The whole-placeholder shape a validation build arrives in. The entry point it resolves is
   * asserted in `entry-point-uri-path.spec.ts`, which runs under the node environment: here jsdom
   * makes `constants` take its `window.app` branch, so this file cannot see the build-time one.
   */
  it('builds the placeholders when every declared key carries the validation placeholder', () => {
    const config = loadConfig({
      CUSTOM_APPLICATION_ID: 'build_template',
      APPLICATION_URL: 'build_template',
      PROCESSOR_URL: 'build_template',
      ENTRY_POINT_URI_PATH: 'build_template',
    });

    expect(config.env.production.applicationId).toBe('__local-development__');
    // Blank, not localhost: an unset override is the signal to read the descriptor the processor
    // publishes in its post-deploy, which is the only source on Connect.
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  /**
   * A key present but blank is the ordinary way a developer parks a value. The guard's "is anything
   * configured?" test and the fallback must read it the same way, or the one in-between state the
   * guard exists to forbid becomes reachable through it.
   */
  it('treats blank values as unset rather than as a configured deployment', () => {
    const config = loadConfig({
      CUSTOM_APPLICATION_ID: '',
      APPLICATION_URL: '',
      PROCESSOR_URL: '',
      ENTRY_POINT_URI_PATH: '',
    });

    expect(config.env.production.applicationId).toBe('__local-development__');
    expect(config.env.production.url).toBe('https://localhost:3001');
    expect(config.additionalEnv.processorUrl).toBe('');
  });

  /**
   * What the validation build actually looks like, and why the placeholder is the evidence rather
   * than the set of keys: Connect assigns the application its URL even with no deployment behind it,
   * and substitutes the placeholder for everything else. Deciding on which keys are set cannot tell
   * this apart from a deployment missing three of them - the case below is that shape, and it must
   * fail while this one builds.
   */
  it('builds the placeholders when only the platform-assigned URL is present', () => {
    const config = loadConfig({
      CUSTOM_APPLICATION_ID: 'build_template',
      APPLICATION_URL: 'https://mc-abc123.europe-west1.gcp.commercetools.app',
      PROCESSOR_URL: 'build_template',
      ENTRY_POINT_URI_PATH: 'build_template',
    });

    expect(config.env.production.applicationId).toBe('__local-development__');
    expect(config.additionalEnv.processorUrl).toBe('');
    // The one field that is NOT a placeholder here: the platform's own assignment is used as given.
    expect(config.env.production.url).toBe(
      'https://mc-abc123.europe-west1.gcp.commercetools.app'
    );
  });

  /**
   * The mirror of the case above, and the reason the two are told apart by the PLACEHOLDER rather
   * than by which key is set. A build carrying only a real URL is not a validation build - it is a
   * deployment missing three keys, and it must fail rather than emit the mixed artifact: a real
   * production origin beside a placeholder id and a localhost CSP.
   */
  it('refuses a build that carries a real URL and nothing else', () => {
    expect(() =>
      loadConfig({
        CUSTOM_APPLICATION_ID: undefined,
        APPLICATION_URL: 'https://real.example.com',
        PROCESSOR_URL: undefined,
        ENTRY_POINT_URI_PATH: undefined,
      })
    ).toThrow(/CUSTOM_APPLICATION_ID/);
  });

  /**
   * The placeholder is evidence only when it is the WHOLE story. Connect substitutes it for every
   * declared key it does not assign itself, so a build carrying it in one key beside real values is
   * not a validation build - it is a deployment with one key misconfigured, and reading it as a
   * validation build would disable the guard for the other three and ship the mixed artifact.
   */
  it('refuses a build carrying the placeholder in one key beside real values', () => {
    expect(() =>
      loadConfig({
        CUSTOM_APPLICATION_ID: 'build_template',
        APPLICATION_URL: 'https://real.example.com',
        PROCESSOR_URL: 'https://processor.example.com',
        ENTRY_POINT_URI_PATH: 'unzer-payments',
      })
    ).toThrow(/CUSTOM_APPLICATION_ID/);
  });
});
