/**
 * The on-premise stack (`deployment/onprem/`) builds the same four applications commercetools Connect
 * deploys, but from the operator's own `.env` and its own Dockerfiles. Nothing in this repository ever
 * runs that build — no spec invokes `docker compose` and no workflow under `.github/workflows/` mentions
 * the on-premise stack — so a value the compose file stops passing, or a Dockerfile stops exporting, is
 * caught by no gate: the image builds, or aborts on the config module's own guard, in the operator's
 * terminal rather than in CI.
 *
 * These specs read that wiring as data. They exist because a Merchant Center bundle is configured at
 * BUILD time: `mc-scripts build` reads `process.env`, bakes the values into the static bundle, and
 * nothing later can correct them. `processor/test/brand-defaults.spec.ts` pairs each carrier of
 * `ENTRY_POINT_URI_PATH` with the claim its Merchant Center registration mints, and two of its six rows
 * hold only because ONE on-premise variable reaches both builds — the assertion below is what makes that
 * premise a checked fact rather than a comment.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/** A path from the repository root, which is the processor's parent. */
const repoFile = (...segments: string[]): string => path.join(__dirname, '..', '..', ...segments);

type ComposeFile = { services?: Record<string, { build?: { args?: Record<string, string> } }> };

/**
 * The on-premise compose file, PARSED rather than matched. A text search for a build-arg name would be
 * satisfied by a commented-out line — and commenting the arg out is one of the two ways the key stops
 * reaching a build — and it could not tell the adjacent `mc` and `mc-view` arg blocks apart, which is
 * the whole question here. `js-yaml` is already the processor's parser for `connect.yaml`.
 */
const onpremCompose = yaml.load(
  readFileSync(repoFile('deployment', 'onprem', 'docker-compose.yml'), 'utf8'),
) as ComposeFile;

const composeBuildArgs = (service: string): Record<string, string> => {
  const args = onpremCompose.services?.[service]?.build?.args;
  if (!args) {
    throw new Error(`deployment/onprem/docker-compose.yml declares no build args for the ${service} service`);
  }
  return args;
};

/**
 * A Dockerfile's instructions, with backslash continuations joined onto one line and comment lines
 * dropped, so a name that survives only in a comment satisfies nothing below.
 */
const dockerfileInstructions = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .filter((instruction) => !/^\s*#/.test(instruction));

/**
 * The instructions of the `build` stage — the only stage that runs `mc-scripts build`, and so the only
 * one whose environment reaches the bundle. An `ARG` declared above the first `FROM` is global and
 * reaches no stage at all, and the `runtime` stage that follows serves the built files, so both are
 * outside the scan.
 */
const buildStageOf = (dockerfile: string): string[] => {
  const instructions = dockerfileInstructions(dockerfile);
  const start = instructions.findIndex((instruction) => /^FROM\s.*\bAS\s+build\b/.test(instruction));
  if (start < 0) {
    throw new Error(`${dockerfile} declares no build stage`);
  }
  const stage = instructions.slice(start + 1);
  const nextStage = stage.findIndex((instruction) => /^FROM\s/.test(instruction));
  return nextStage < 0 ? stage : stage.slice(0, nextStage);
};

/** The names a build stage declares as `ARG`, which is what `docker build` accepts a value for. */
const declaredArgs = (buildStage: string[]): string[] =>
  buildStage.flatMap((instruction) =>
    Array.from(instruction.matchAll(/^ARG\s+([A-Z][A-Z0-9_]*)/g), (match) => match[1] as string),
  );

/** The names a build stage exports as `ENV`, which is what `mc-scripts build` reads from the process. */
const exportedEnv = (buildStage: string[]): string[] =>
  buildStage
    .filter((instruction) => /^ENV\s/.test(instruction))
    .flatMap((instruction) => Array.from(instruction.matchAll(/([A-Z][A-Z0-9_]*)=/g), (match) => match[1] as string));

/**
 * The `DEPLOYMENT_KEYS` a Merchant Center config module declares, read as TEXT because nothing else can
 * reach the value: both modules export only `config` as their default, so the array is module-private
 * and an import would first require adding an export to another application's source. Adding one would
 * be wrong even though it is easy. For `mc` it would not even work: that module's first statement imports
 * `./src/constants`, a TypeScript file Node fails to resolve with `ERR_MODULE_NOT_FOUND` before any of
 * the module's own code runs. `mc-view` does import — this suite injects none of its four deployment keys,
 * so the guard stays silent — but an import EXECUTES the module, and that guard throws for any ambient
 * environment carrying between one and three of the four, so such a spec would pass or fail on the shell
 * it inherits. Both would also make the processor depend on another application as CODE instead of reading
 * it as data. The declaration is a top-level array of quoted literals, so a read is enough.
 *
 * A shape this cannot find is an error, never an empty set, because an empty set satisfies every
 * assertion below. What that guard does NOT cover is a MIXED-quote array: one double-quoted entry drops
 * that single key while the count stays non-zero, so the key goes unasserted and the suite stays green.
 * Both applications pin `singleQuote: true` in their own `.prettierrc`, which is what makes this a
 * residual rather than a defect.
 */
const deploymentKeysOf = (configModule: string): string[] => {
  const source = readFileSync(configModule, 'utf8');
  const declaration = source.match(/const DEPLOYMENT_KEYS = \[([^\]]*)]/);
  if (declaration) {
    const keys = Array.from(declaration[1]!.matchAll(/'([A-Z][A-Z0-9_]*)'/g), (match) => match[1] as string);
    if (keys.length === 0) {
      throw new Error(`${configModule} declares an empty DEPLOYMENT_KEYS`);
    }
    return keys;
  }
  // The mc config module declares no key list of its own: its deployment inputs are the `${env:KEY}`
  // placeholders mc-scripts substitutes at build time. Those ARE the keys the image must receive -
  // minus the development-only initial project key, which no production bundle reads.
  const placeholders = new Set(
    Array.from(source.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)}/g), (match) => match[1] as string),
  );
  placeholders.delete('CTP_INITIAL_PROJECT_KEY');
  if (placeholders.size === 0) {
    throw new Error(`${configModule} declares neither DEPLOYMENT_KEYS nor \${env:...} placeholders`);
  }
  return [...placeholders];
};

/** The two Merchant Center applications the on-premise stack builds, with the files that wire each. */
const ONPREM_MC_BUILDS: [service: string, configModule: string, dockerfile: string][] = [
  ['mc', repoFile('mc', 'custom-application-config.mjs'), repoFile('deployment', 'onprem', 'mc.Dockerfile')],
  ['mc-view', repoFile('mc-view', 'custom-view-config.mjs'), repoFile('deployment', 'onprem', 'mc-view.Dockerfile')],
];

describe('the on-premise compose file and Dockerfiles wire both Merchant Center builds', () => {
  // The two rows keyed `mc-view permission group` in `brand-defaults.spec.ts` hold only while ONE compose
  // variable reaches both builds. Rewiring the `mc-view` service to a per-surface variable leaves those
  // rows pairing a carrier under a rule its value never reaches, and `docker compose build` still
  // succeeds — so the premise is read from the compose file rather than trusted from a comment.
  it('builds mc and mc-view from the same on-premise ENTRY_POINT_URI_PATH variable', () => {
    expect(composeBuildArgs('mc').ENTRY_POINT_URI_PATH).toBe('${ENTRY_POINT_URI_PATH}');
    expect(composeBuildArgs('mc-view').ENTRY_POINT_URI_PATH).toBe('${ENTRY_POINT_URI_PATH}');
  });

  // A key a config module counts among its DEPLOYMENT_KEYS but the image never receives is the wider
  // class the entry point belongs to: the module's own guard then aborts the build naming that key, or
  // — for a key the guard treats as platform-assigned — the bundle is baked with the fallback and the
  // operator's browser is the first signal. The compose arg alone is not enough, because the value only
  // reaches `mc-scripts build` if the build stage also declares the ARG and exports it as an ENV.
  it.each(ONPREM_MC_BUILDS)(
    'passes every %s deployment key into its image as a build arg, an ARG and a build-stage ENV',
    (service, configModule, dockerfile) => {
      const deploymentKeys = deploymentKeysOf(configModule);
      const buildStage = buildStageOf(dockerfile);

      expect(Object.keys(composeBuildArgs(service))).toEqual(expect.arrayContaining(deploymentKeys));
      expect(declaredArgs(buildStage)).toEqual(expect.arrayContaining(deploymentKeys));
      expect(exportedEnv(buildStage)).toEqual(expect.arrayContaining(deploymentKeys));
    },
  );
});
