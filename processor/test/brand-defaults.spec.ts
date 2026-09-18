/**
 * The provider seam's invariant: the processor's TypeScript carries NO brand literal. Every
 * vendor-varying default lives in `providers/psp/brand.defaults.json` - a hand-maintained file of this
 * concrete Unzer distribution - and the manifest merely imports it. These specs pin that
 * seam: re-inlining a default in `manifest.ts`, or a hand edit that drops a key, fails here instead of
 * booting a distribution with a missing identity.
 *
 * `managePermission` is the other half of the identity chain, and the reason it belongs in the seam:
 * the MC permission the `/operations` mutations demand is the claim the Merchant Center mints from the
 * config app's registered `entryPointUriPath`, so it is a property of the deployment, not of the code.
 * A neutral code fallback would be correct for no deployment that exists and would answer 403 on every
 * config mutation - so the fallback is the brand's own value, and this spec COMPUTES the claim that
 * value has to equal from the entry point every deployment carrier declares, by the rule that carrier's
 * own Merchant Center registration applies (two rules, see ENTRY_POINT_CARRIERS). It is the only place the
 * two sides are compared: a carrier that disagrees answers 403 on every merchant `/operations` route -
 * store connect/edit/disconnect, `testconnection`, `upload-logo`, and the payment panel's capture,
 * refund and cancel - and neither side's own suite can see the other.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrandDefaults } from '../src/domain';
import { getConfig } from '../src/infrastructure/config/config';
import { pspManifest } from '../src/providers/psp';

const BRAND_DEFAULTS_PATH = 'src/providers/psp/brand.defaults.json';

/**
 * The `BrandDefaults` keys whose value is a string. The required list below asserts a non-empty string,
 * so the compiler must reject a key of another type being added to it - a nested or boolean brand
 * default would make "non-empty" meaningless.
 */
type StringBrandDefaultKey = {
  [K in keyof BrandDefaults]-?: string extends BrandDefaults[K] ? K : never;
}[keyof BrandDefaults] &
  string;

/** The `BrandDefaults` keys every distribution must supply with a real value. */
const REQUIRED_BRAND_DEFAULT_KEYS: StringBrandDefaultKey[] = [
  'displayName',
  'paymentInterface',
  'telemetryHeaderName',
  'integrator',
  'shoppingCartExtension',
  'customObjectContainer',
  // The per-store payment-methods container: empty would leave the payment-methods
  // repository writing to a container with no name.
  'paymentMethodsContainer',
  'defaultHost',
  // The live twin of `defaultHost` - the host a store in `mode: 'live'` resolves, so an empty
  // value points every LIVE vendor call at `https:///…`. Every brand.defaults.json in this
  // distribution is hand-edited and tsc passes an empty string, so this is the only check that catches
  // one.
  'defaultHostLive',
  'managePermission',
  // The container the webhook idempotency markers are written to: empty would make every marker key
  // collide in one unnamed container.
  'webhookMarkerContainer',
  // The commercetools custom-Type key the connector registers and stamps on every CT Payment.
  'paymentTypeKey',
];

/**
 * The back office is the one default a distribution may legitimately have nothing for: a vendor with no
 * merchant portal has no URL, and inventing a placeholder would ship the operator a broken link. It is
 * modelled as an all-or-nothing PAIR, so a live payment can never resolve to the test portal - the type
 * makes a half-configured pair unrepresentable, and this asserts the shape a present pair has.
 */
const backOfficePair = (defaults: BrandDefaults): { test: string; live: string } | undefined => defaults.backOffice;

/** Uppercase the first character and leave the rest alone - lodash `upperFirst`, which the MC uses. */
const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The resource-access key commercetools derives from an entry point. This restates
 * `formatEntryPointUriPathToResourceAccessKey` from `@commercetools-frontend/application-config`
 * (`dist/formatters-*.js`, reached from `mc/src/constants.ts` via
 * `entryPointUriPathToPermissionKeys`): each `_`- and `-`-separated word is capitalised, `_` survives,
 * `-` is dropped, and a `-` before a digit becomes `/`. That package is a dependency of `mc`, not of
 * the processor, so NEITHER of the two rules restated here can be imported - the tables below, each
 * carrying its own formatter's JSDoc examples, are what keep these copies honest.
 */
const entryPointToResourceAccessKey = (entryPointUriPath: string): string =>
  entryPointUriPath
    .split('_')
    .map(upperFirst)
    .join('_')
    .split('-')
    .map((word, index) => (index > 0 && /^\d/.test(word) ? `/${word}` : upperFirst(word)))
    .join('');

/**
 * The resource-access key commercetools derives from a permission GROUP name - the second of the two
 * rules. This restates `formatPermissionGroupNameToResourceAccessKey` from the same module:
 * a plain `-`-separated capitalisation, with neither the `_`-preserving pass nor the `-`-before-digit
 * rule above. The two agree on `unzer-payments` and disagree on any name ending in `-<digit>`, so the
 * `avengers-1` row in each table below is what keeps one from silently standing in for the other.
 */
const permissionGroupToResourceAccessKey = (permissionGroupName: string): string =>
  permissionGroupName.split('-').map(upperFirst).join('');

/**
 * The permission the Merchant Center puts in the `user_permissions` claim for a resource access: the
 * `Manage` access under a `can` prefix (`toCanCase` in `@commercetools-frontend/permissions`). This is
 * the exact string `requireManagePermission` looks for in the forwarded claims. The `can` + `Manage`
 * prefix is common to both registrations; the resource-access key is NOT, so the caller supplies the
 * derivation its carrier's registration uses.
 */
const manageClaimFor = (value: string, resourceAccessKeyOf: (value: string) => string): string =>
  `canManage${resourceAccessKeyOf(value)}`;

/** A path from the repository root, which is the processor's parent. */
const repoFile = (...segments: string[]): string => path.join(__dirname, '..', '..', ...segments);

/**
 * Every declaration of `ENTRY_POINT_URI_PATH` that carries a value, once per Merchant Center
 * registration that value reaches - because the registrations are two, they name the claim by two
 * different rules, and a carrier read by both must satisfy both.
 *
 * The `mc` Custom Application takes the value as its `entryPointUriPath` and declares `oAuthScopes`
 * with no `additionalOAuthScopes` (`mc/custom-application-config.mjs:101`), so its claim is the default
 * one, minted from the entry-point URI path. The `mc-view` Custom View has no `entryPointUriPath` at
 * all: it takes the value as `additionalOAuthScopes[0].name`
 * (`mc-view/custom-view-config.mjs:94,123-129`), which is a permission GROUP name, formatted by the
 * group rule. `mc/.env.template` and `mc-view/.env.template` each configure one of the two
 * applications, so each pairs under one rule. The two on-premise files configure BOTH:
 * `deployment/onprem/docker-compose.yml:102,137` passes the one key to the `mc` and `mc-view` builds
 * alike, and each Dockerfile turns it into a build-stage `ENV` (`mc.Dockerfile:15,20`,
 * `mc-view.Dockerfile:11,16`), so an on-premise value must mint the brand permission under BOTH rules
 * or one of the two surfaces answers 403. That plumbing is what puts four rows in this table instead of
 * two, and it is asserted - not assumed - in `onprem-build-config.spec.ts`, which reads the compose file
 * and both Dockerfiles; a rewiring that sent the `mc-view` build a different variable reddens there.
 *
 * `connect.yaml` declares the key with no value (the operator supplies it per deployment) and so pairs
 * with nothing; `mc/src/constants.ts` and `mc-view/custom-view-config.mjs` hold the same value as a
 * build-time fallback and are pinned by their own suites - but only as the literal `unzer-payments`
 * (`mc-view/test/deployment-config.spec.ts:95`), never as the derived claim, so this table is the only
 * place either rule is compared against `managePermission`.
 */
const ENTRY_POINT_CARRIERS: [
  label: string,
  registration: string,
  file: string,
  resourceAccessKeyOf: (value: string) => string,
][] = [
  ['mc/.env.template', 'mc Custom Application', repoFile('mc', '.env.template'), entryPointToResourceAccessKey],
  [
    'mc-view/.env.template',
    'mc-view permission group',
    repoFile('mc-view', '.env.template'),
    permissionGroupToResourceAccessKey,
  ],
  [
    'deployment/onprem/.env.template',
    'mc Custom Application',
    repoFile('deployment', 'onprem', '.env.template'),
    entryPointToResourceAccessKey,
  ],
  [
    'deployment/onprem/.env.template',
    'mc-view permission group',
    repoFile('deployment', 'onprem', '.env.template'),
    permissionGroupToResourceAccessKey,
  ],
  [
    'deployment/onprem/.env-sample',
    'mc Custom Application',
    repoFile('deployment', 'onprem', '.env-sample'),
    entryPointToResourceAccessKey,
  ],
  [
    'deployment/onprem/.env-sample',
    'mc-view permission group',
    repoFile('deployment', 'onprem', '.env-sample'),
    permissionGroupToResourceAccessKey,
  ],
];

/**
 * The value a carrier declares, quoted (`mc`, `mc-view`) or bare (the on-premise files). A carrier that
 * stopped declaring the key is a failure and not a silent pass: an unset entry point makes the MC mint
 * `canManage`, which this brand's `managePermission` never equals.
 */
const declaredEntryPoint = (label: string, file: string): string => {
  const match = readFileSync(file, 'utf8').match(/^ENTRY_POINT_URI_PATH="?([^"\r\n]*)"?/m);
  if (!match) {
    throw new Error(`${label} declares no ENTRY_POINT_URI_PATH`);
  }
  return match[1] as string;
};

describe('brand defaults - the hand-maintained file the provider manifest imports', () => {
  it('sources the manifest brand defaults from brand.defaults.json, not from TypeScript literals', () => {
    const onDisk = JSON.parse(readFileSync(path.join(process.cwd(), BRAND_DEFAULTS_PATH), 'utf8'));

    expect(pspManifest.brandDefaults).toEqual(onDisk);
  });

  it('supplies every REQUIRED BrandDefaults key as a non-empty value', () => {
    REQUIRED_BRAND_DEFAULT_KEYS.forEach((key) => {
      expect(pspManifest.brandDefaults[key]).toEqual(expect.any(String));
      expect(pspManifest.brandDefaults[key]?.length).toBeGreaterThan(0);
    });
  });

  // Both halves or neither: the type carries the pair as one object, so a distribution either declares a
  // back office with both URLs or declares none at all.
  it('declares the back office as a complete pair, or not at all', () => {
    const pair = backOfficePair(pspManifest.brandDefaults);

    if (pair !== undefined) {
      expect(pair.test).toEqual(expect.any(String));
      expect(pair.live).toEqual(expect.any(String));
    }
  });
});

describe('config manage-permission default', () => {
  it("falls back to THIS distribution's permission, not to a code literal", () => {
    expect(getConfig().configManagePermission).toBe(pspManifest.brandDefaults.managePermission);
  });

  it('a BRAND_MANAGE_PERMISSION env var must not reach it - brand-only, no env door', () => {
    // It is an AUTHORIZATION decision only correct when it agrees with the entry point the config app
    // is registered under - a pairing fixed when brand.defaults.json and the mc app's
    // ENTRY_POINT_URI_PATH are authored, which a runtime env var cannot see. So there is no runtime
    // override at all.
    const previous = process.env.BRAND_MANAGE_PERMISSION;
    process.env.BRAND_MANAGE_PERMISSION = 'canManageSomethingUnpaired';
    try {
      expect(getConfig().configManagePermission).toBe(pspManifest.brandDefaults.managePermission);
    } finally {
      if (previous === undefined) delete process.env.BRAND_MANAGE_PERMISSION;
      else process.env.BRAND_MANAGE_PERMISSION = previous;
    }
  });
});

describe('managePermission pairs with the entry point the Merchant Center mints it from', () => {
  // The five examples the library's own JSDoc gives for `formatEntryPointUriPathToResourceAccessKey`,
  // plus `avengers-1`, measured against the installed library. They pin that restatement: without them,
  // a derivation that agreed with `unzer-payments` by accident - plain `split('-')`, which is the GROUP
  // rule below - would pass here and mislead the first fork that uses a digit or an underscore in its
  // entry point.
  it.each([
    ['avengers', 'Avengers'],
    ['the-avengers', 'TheAvengers'],
    ['the_avengers', 'The_Avengers'],
    ['avengers-01', 'Avengers/01'],
    ['avengers_01', 'Avengers_01'],
    ['avengers-1', 'Avengers/1'],
  ])('derives the entry-point resource-access key of %s as %s', (entryPointUriPath, expected) => {
    expect(entryPointToResourceAccessKey(entryPointUriPath)).toBe(expected);
  });

  // The two examples the JSDoc of `formatPermissionGroupNameToResourceAccessKey` gives, plus the input
  // that separates the group rule from the entry-point rule. `avengers-1` satisfies BOTH
  // `PERMISSION_GROUP_NAME_REGEX` and `ENTRY_POINT_URI_PATH_REGEX`, so a fork may adopt an entry point
  // ending in `-<digit>` and be handed `canManageAvengers/1` by the config app and `canManageAvengers1`
  // by the panel - one `managePermission` cannot equal both, and only this row makes the suite say so.
  it.each([
    ['books', 'Books'],
    ['the-books', 'TheBooks'],
    ['avengers-1', 'Avengers1'],
  ])('derives the permission-group resource-access key of %s as %s', (permissionGroupName, expected) => {
    expect(permissionGroupToResourceAccessKey(permissionGroupName)).toBe(expected);
  });

  // The pairing is what a 403 turns on, not the permission's format: `canManageSomethingUnpaired` is a
  // well-formed manage permission that no MC ever mints, so only the claim COMPUTED from the entry point
  // each carrier declares tells a working value from a broken one. A carrier read by both registrations
  // is asserted once per registration, so its failure names the surface that would 403.
  it.each(ENTRY_POINT_CARRIERS)(
    '%s declares the entry point the %s mints this brand permission from',
    (label, _registration, file, resourceAccessKeyOf) => {
      expect(manageClaimFor(declaredEntryPoint(label, file), resourceAccessKeyOf)).toBe(
        pspManifest.brandDefaults.managePermission,
      );
    },
  );
});
