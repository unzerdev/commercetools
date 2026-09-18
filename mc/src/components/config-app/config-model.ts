/**
 * Pure mapping between the processor's persisted `StoreConfigDto` (the Unzer connection envelope) and the
 * Formik-friendly `ConfigFormValues` the connection screen binds to. No React, no I/O — the screen calls
 * these on load and on save so the wire shape never leaks into the form and vice versa.
 *
 * `GET` returns the credential pair IN THE CLEAR (processor), so the form is seeded with the real
 * keys and `formToConfig` sends back whatever the operator left in the fields — an untouched save re-sends
 * the same pair the processor already holds. {@link REDACTED_SECRET} is therefore no longer part of the
 * normal round-trip; it remains only as a compatibility guard against an older processor that still masks,
 * whose mask the processor's own reconciliation resolves back to the stored value.
 */

import type {
  StoreConfigDto,
  StoreEnvironmentBlockDto,
  StoreMode,
} from '../../types/config';

/** Re-exported so the form model stays the one import a screen needs. */
export type { StoreMode };

/** The two Unzer keys the connection form edits for one environment. */
export type EnvironmentFormValues = {
  publicKey: string;
  privateKey: string;
};

/** The connection form model the screen binds to: the active mode plus both environments' keys. */
export type ConfigFormValues = {
  mode: StoreMode;
  environments: {
    sandbox: EnvironmentFormValues;
    live: EnvironmentFormValues;
  };
};

const toEnvironmentForm = (
  block: StoreEnvironmentBlockDto | undefined
): EnvironmentFormValues => ({
  publicKey: block?.credentials?.publicKey ?? '',
  privateKey: block?.credentials?.privateKey ?? '',
});

export const configToForm = (dto: StoreConfigDto): ConfigFormValues => ({
  mode: dto.mode ?? 'sandbox',
  environments: {
    sandbox: toEnvironmentForm(dto.environments?.sandbox),
    live: toEnvironmentForm(dto.environments?.live),
  },
});

/**
 * Serialize one environment back to the wire block, omitting an empty key rather than sending `''`.
 * The secret round-trip relies on the form still holding {@link REDACTED_SECRET} for an unedited key —
 * the processor reconciles the mask back to the stored value.
 */
const fromEnvironmentForm = (
  env: EnvironmentFormValues
): StoreEnvironmentBlockDto => {
  const credentials: { publicKey?: string; privateKey?: string } = {};
  if (env.publicKey !== '') credentials.publicKey = env.publicKey;
  if (env.privateKey !== '') credentials.privateKey = env.privateKey;

  return Object.keys(credentials).length > 0 ? { credentials } : {};
};

/**
 * Serialize the whole form: BOTH environments travel on every save.
 *
 * The PUT replaces the whole document, so both blocks have to be there or the environment left out
 * would lose its stored keys. Sending the form's copy of the environment the operator is NOT editing
 * has one consequence worth knowing: the processor probes every environment whose credentials differ
 * from what is stored, so an invalid draft typed into the other environment and never saved is probed
 * too, and its rejection blocks the save of the one being edited. Accepted deliberately — an operator
 * configuring both environments in one sitting saves both in one click.
 */
export const formToConfig = (values: ConfigFormValues): StoreConfigDto => ({
  mode: values.mode,
  environments: {
    sandbox: fromEnvironmentForm(values.environments.sandbox),
    live: fromEnvironmentForm(values.environments.live),
  },
});

/**
 * Whether a persisted environment block holds both Unzer keys (a masked `'***'` counts as present). This
 * tests the LOADED/last-saved config — never the live form — so typing a key into a not-connected env
 * does not flip the connected gating before a save.
 */
export const environmentConnected = (
  block: StoreEnvironmentBlockDto | undefined
): boolean =>
  (block?.credentials?.publicKey ?? '').trim() !== '' &&
  (block?.credentials?.privateKey ?? '').trim() !== '';
