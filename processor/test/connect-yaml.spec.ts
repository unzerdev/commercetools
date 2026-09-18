/**
 * `connect.yaml` is the connector's deployment contract, and nothing else in this repository reads it:
 * the platform parses it at install time, long after any gate here would have run. This is that check.
 *
 * It asserts the file parses at all, plus the invariants whose loss is silent rather than loud: an
 * undeclared or extra key hands an operator a deployment configured against a contract the code does
 * not read, a `CTP_REGION` that is optional or carries a `default` lets a deployment install on the
 * prefilled region, and a key declared as required that the code treats as optional makes an install
 * ask for a value the operator cannot know yet (the origin Connect assigns after the first deploy).
 *
 *
 * The declared-versus-read check reads the SOURCE, not a list maintained beside it. A hand-kept
 * expectation cannot catch the drift it exists for: `RETURN_URL` sat in such a list, declared to
 * operators and read by nothing, and stayed green until it was deleted from both by hand. So the read
 * set is scanned out of `src/` — every static `process.env.X` read — and every key on either side that
 * is deliberately absent from the other is listed below WITH its reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import yaml from 'js-yaml';
import { REQUIRED_CT_SCOPES } from '../src/infrastructure/config/required-scopes';

type ConfigEntry = { key: string; description?: string; required?: boolean; default?: unknown };
type Application = {
  name: string;
  configuration?: { standardConfiguration?: ConfigEntry[]; securedConfiguration?: ConfigEntry[] };
};
type ConnectManifest = { deployAs?: Application[] };

const CONNECT_YAML = path.join(__dirname, '..', '..', 'connect.yaml');

/**
 * Configuration keys the manifest declares but the PROCESSOR does not read, each for a stated reason —
 * every one belongs to another application in the same manifest or to the platform itself.
 */
const DECLARED_FOR_OTHERS: Readonly<Record<string, string>> = {
  CLOUD_IDENTIFIER: 'Merchant Center application region selector (mc / mc-view)',
  CUSTOM_APPLICATION_ID: 'the mc custom application id, registered in the Merchant Center',
  CUSTOM_VIEW_ID: 'the mc-view custom view id, registered in the Merchant Center',
  ENTRY_POINT_URI_PATH: 'the mc entry point (`mc/src/constants.ts` reads it)',
  PROCESSOR_URL: 'the processor URL the Merchant Center applications call, read in their own builds',
};

/**
 * Environment variables the processor reads but the manifest deliberately does NOT declare, each for a
 * stated reason. A declared key is a value an operator is asked to supply; these are not that.
 */
const UNDECLARED_BY_DESIGN: Readonly<Record<string, string>> = {
  // An opt-in diagnostic: with it set, the vendor transport logs method/path/body (never the Authorization
  // header) so a vendor refusal can be read against the actual outbound payload. Not an operator input -
  // a deployment that declared it would invite leaving it on.
  PSP_TRACE_VENDOR_CALLS: 'developer diagnostic, opt-in and off by default; deliberately not deployable',
  // Connect injects this into the post-deploy process of a `service` application - it is the URL the
  // platform assigned this deployment, which is why the descriptor is published from there and not
  // read at runtime. An operator never supplies it, so declaring it would invite overriding it.
  CONNECT_SERVICE_URL: 'injected by Connect into the post-deploy process, not an operator input',
  // npm injects these into every `npm run` process; the logger reads them for its version/name fields and
  // falls back to 'unknown'. An operator never supplies them, and a Connect deployment runs under npm.
  npm_package_name: 'injected by npm at run time, not an operator input',
  npm_package_version: 'injected by npm at run time, not an operator input',
  // Service tuning with safe defaults (`config.ts`: info / 5000 ms). Not a deployment input: a Connect
  // operator has no reason to change either, and a declared knob invites a value nobody asked for.
  LOGGER_LEVEL: 'service tuning with a safe default; not an operator input on Connect',
  HEALTH_CHECK_TIMEOUT: 'service tuning with a safe default; not an operator input on Connect',
};

const SRC_DIR = path.join(__dirname, '..', 'src');

/** Every `.ts` file under `src/`, so the scan below cannot miss a directory. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? sourceFiles(full) : item.name.endsWith('.ts') ? [full] : [];
  });
}

/** The environment variables the processor's own source reads: every static `process.env.NAME`. */
function readEnvKeys(): string[] {
  const source = sourceFiles(SRC_DIR)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  return [...new Set([...source.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))].sort();
}

/** The parsed manifest — `yaml.load` THROWS on a malformed file, which is the first assertion. */
const load = (): ConnectManifest => yaml.load(fs.readFileSync(CONNECT_YAML, 'utf8')) as ConnectManifest;

const configEntries = (app: Application): ConfigEntry[] => [
  ...(app.configuration?.standardConfiguration ?? []),
  ...(app.configuration?.securedConfiguration ?? []),
];

const standardConfig = (appName: string): ConfigEntry[] => {
  const app = load().deployAs?.find((candidate) => candidate.name === appName);
  return app?.configuration?.standardConfiguration ?? [];
};

const entry = (appName: string, key: string): ConfigEntry | undefined =>
  standardConfig(appName).find((candidate) => candidate.key === key);

const securedEntry = (appName: string, key: string): ConfigEntry | undefined => {
  const app = load().deployAs?.find((candidate) => candidate.name === appName);
  return app?.configuration?.securedConfiguration?.find((candidate) => candidate.key === key);
};

describe('connect.yaml', () => {
  it('parses as YAML', () => {
    expect(() => load()).not.toThrow();
    expect(load().deployAs?.length).toBeGreaterThan(0);
  });

  it('declares the processor service application', () => {
    expect(load().deployAs?.map((app) => app.name)).toContain('processor');
  });

  // A key declared here but never read is a value an operator supplies into nothing; a key the code
  // reads but does not declare is a deployment that cannot be configured at all. Both are invisible
  // until a real install, so the set is pinned.
  it('declares every environment variable the processor reads, bar the ones listed as by-design', () => {
    const declared = new Set((load().deployAs ?? []).flatMap((app) => configEntries(app).map((item) => item.key)));

    const undeclared = readEnvKeys().filter((key) => !declared.has(key) && UNDECLARED_BY_DESIGN[key] === undefined);

    expect(undeclared).toEqual([]);
  });

  it('declares nothing the processor ignores, bar the keys listed as belonging to another application', () => {
    const read = new Set(readEnvKeys());
    const declared = [...new Set((load().deployAs ?? []).flatMap((app) => configEntries(app).map((item) => item.key)))];

    const unread = declared.filter((key) => !read.has(key) && DECLARED_FOR_OTHERS[key] === undefined).sort();

    expect(unread).toEqual([]);
  });

  // Both halves are load-bearing. Connect falls back to a declared `default` when a deployment supplies
  // no value, so a default alongside `required: true` would let an eu-central-1.aws deployment install
  // on europe-west1.gcp and validate merchant JWTs against the wrong mc-api host.
  it('requires CTP_REGION and declares NO default for it', () => {
    const region = entry('processor', 'CTP_REGION');
    expect(region).toBeDefined();
    expect(region?.required).toBe(true);
    expect(region).not.toHaveProperty('default');
  });

  // Connect assigns the processor its URL AFTER the first deploy, so there is nothing for an operator to
  // supply: the processor derives its origin from each request's Host header, and the JWT audience gate
  // runs against that origin. The Merchant Center applications carry the URL, not this one.
  it('declares NO processor public URL - the origin is derived per request', () => {
    expect(entry('processor', 'PROCESSOR_PUBLIC_URL')).toBeUndefined();
    expect(entry('processor', 'PROCESSOR_URL')).toBeUndefined();
  });

  it('declares PSP_ALLOWED_RETURN_ORIGINS optional (empty admits every http(s) origin) and PSP_RETURN_FAILURE_URL required', () => {
    expect(entry('processor', 'PSP_ALLOWED_RETURN_ORIGINS')?.required).toBe(false);
    expect(entry('processor', 'PSP_RETURN_FAILURE_URL')?.required).toBe(true);
  });

  // The Unzer key pair and the layered store settings are entered per store in the Merchant Center and
  // stored encrypted; declaring an environment baseline for them would be a second, invisible source.
  it('declares no vendor credentials and no store-settings envelope', () => {
    expect(securedEntry('processor', 'UNZER_PUBLIC_KEY')).toBeUndefined();
    expect(securedEntry('processor', 'UNZER_PRIVATE_KEY')).toBeUndefined();
    expect(securedEntry('processor', 'STORE_SETTINGS_JSON')).toBeUndefined();
  });

  // The processor's URL is not known at install time, so a first pass leaves it empty and fills it in
  // once Connect has assigned one; a required key would block that first install outright.
  it('declares PROCESSOR_URL optional in both Merchant Center applications', () => {
    for (const app of ['mc', 'mc-view']) {
      const processorUrl = entry(app, 'PROCESSOR_URL');
      expect(processorUrl).toBeDefined();
      expect(processorUrl?.required).toBe(false);
    }
  });

  /**
   * The scopes the status endpoint probes ARE the scopes the deployment asks an operator to grant. Both
   * halves matter: a scope the code needs and the manifest never mentions is an install an operator
   * cannot configure correctly, and a scope the health check does not probe is one whose absence surfaces
   * on the first write instead of on the status page - which is how a client without
   * `manage_key_value_documents` passed the health check and failed on the merchant's first save.
   */
  it('asks the operator for exactly the scopes the status endpoint probes', () => {
    const description = entry('processor', 'CTP_CLIENT_ID')?.description ?? '';

    const named = [...description.matchAll(/\b(?:manage|view|introspect)_[a-z_]+\b/g)].map((match) => match[0]);

    expect([...new Set(named)].sort()).toEqual([...REQUIRED_CT_SCOPES].sort());
  });

  // A description carrying `: ` is what breaks the file: unquoted, YAML reads it as a nested mapping.
  // Parsing proves each one survived as the string it is meant to be.
  it('keeps every standardConfiguration description a string', () => {
    const descriptions = standardConfig('processor').map((item) => item.description);
    expect(descriptions.length).toBeGreaterThan(0);
    descriptions.forEach((description) => expect(typeof description).toBe('string'));
  });
});
