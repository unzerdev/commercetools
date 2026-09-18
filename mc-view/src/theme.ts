import { designTokens } from '@commercetools-uikit/design-system';

/**
 * Unzer brand theming for commercetools UI Kit.
 *
 * UI Kit v20 does not read colors from CSS custom properties at runtime — its
 * components inline `designTokens.colorPrimary*` (literal `hsl(...)`) into their
 * emotion styles. The tokens object is a plain (non-frozen) module singleton and
 * is read by property access at render time, so remapping the `primary` scale
 * once at startup re-themes every UI Kit component (buttons, toggles, radios,
 * focus rings) to Unzer's brand color.
 *
 * Unzer primary = #ED1856 ≈ hsl(342, 86%, 51%). We keep UI Kit's per-step
 * lightness so component states (hover/active/tints) keep working, only shifting
 * hue + saturation.
 */

/**
 * Unzer black, the source of the `colorSolid` token below. The non-UI-Kit
 * accents are not here: they come from the `--unzer-*` custom properties in
 * `unzer.css`, which the global classes consume.
 */
const UNZER = {
  text: '#0C1332',
} as const;

/** Exported for the theme canary spec: every key must pre-exist on UI Kit's `designTokens`. */
export const UNZER_PRIMARY_SCALE: Record<string, string> = {
  colorPrimary: 'hsl(342, 86%, 51%)',
  colorPrimary10: 'hsl(342, 86%, 19%)',
  colorPrimary20: 'hsl(342, 70%, 33%)',
  colorPrimary25: 'hsl(342, 72%, 44%)',
  colorPrimary30: 'hsl(342, 78%, 49%)',
  colorPrimary40: 'hsl(342, 92%, 62%)',
  colorPrimary85: 'hsl(342, 90%, 84%)',
  colorPrimary90: 'hsl(342, 96%, 93%)',
  colorPrimary95: 'hsl(342, 100%, 97%)',
  colorPrimary98: 'hsl(342, 100%, 99%)',
  // Base "solid" token → Unzer black. Drives UI Kit text and the
  // SecondaryButton border/label, so secondary actions read as Unzer black
  // natively.
  colorSolid: UNZER.text,
};

let applied = false;

/** Remap UI Kit's primary scale to Unzer's. Call once before rendering. */
export const applyUnzerTheme = (): void => {
  if (applied) return;
  Object.assign(designTokens as Record<string, string>, UNZER_PRIMARY_SCALE);
  applied = true;
};
