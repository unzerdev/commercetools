import { designTokens } from '@commercetools-uikit/design-system';
import { UNZER_PRIMARY_SCALE } from '../src/theme';

/**
 * The canary for the re-theming contract. `applyUnzerTheme` works by OVERWRITING tokens UI Kit
 * already ships — `Object.assign` would just as silently ADD a key nothing reads if a UI Kit
 * upgrade renamed or dropped one, and the brand color would fall back to UI Kit's own with no
 * failing gate. This spec runs against the pristine tokens object (nothing here calls
 * `applyUnzerTheme`), so every override key must pre-exist on `designTokens`.
 */
describe('UNZER_PRIMARY_SCALE', () => {
  it('overrides only tokens UI Kit still ships', () => {
    const missing = Object.keys(UNZER_PRIMARY_SCALE).filter(
      (token) => !Object.prototype.hasOwnProperty.call(designTokens, token)
    );
    expect(missing).toEqual([]);
  });
});
