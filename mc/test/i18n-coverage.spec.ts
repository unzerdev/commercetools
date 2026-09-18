import type { MessageDescriptor } from 'react-intl';
import coreMessages from '../src/i18n/data/core.json';
import appMessages from '../src/components/config-app/messages';
import connectionMessages from '../src/components/config-app/sections/connection/messages';
import paymentModeMessages from '../src/components/config-app/sections/payment-methods/method-list/messages';
import methodSettingsMessages from '../src/components/config-app/sections/payment-methods/method-settings/messages';
import sharedMessages from '../src/components/shared/messages';
import methodDescriptions from '../src/components/config-app/sections/payment-methods/catalogue/method-descriptions';

/**
 * i18n completeness guard. `parseChunkImport` returns `core.json` verbatim and does NOT fall back to the
 * inline `defaultMessage`, so any `defineMessages` id absent from `core.json` renders as a runtime
 * `@formatjs/intl MISSING_TRANSLATION`. This test fails whenever the ID SET of `core.json` drifts from the
 * declared descriptors in either direction — a new id not yet extracted, or a stale/orphaned entry — which
 * is exactly the regression the runtime error signals. Regenerate with `npm run extract-intl` after
 * touching any `messages.ts`.
 *
 * The descriptors are concatenated as a flat list rather than spread into one object because sibling
 * modules reuse JS keys (e.g. both `ConfigApp.saveError` and `ConfigApp.Connection.saveError` are keyed
 * `saveError`); a merge would drop one id from the check.
 */
const descriptors: MessageDescriptor[] = [
  appMessages,
  connectionMessages,
  paymentModeMessages,
  methodSettingsMessages,
  sharedMessages,
  methodDescriptions,
].flatMap((module) => Object.values(module));

const catalogue = coreMessages as Record<string, string>;

describe('i18n message coverage', () => {
  it('gives every declared message a non-empty id and defaultMessage', () => {
    descriptors.forEach((descriptor) => {
      expect(typeof descriptor.id).toBe('string');
      expect(descriptor.id).not.toHaveLength(0);
      expect(typeof descriptor.defaultMessage).toBe('string');
      expect(descriptor.defaultMessage).not.toHaveLength(0);
    });
  });

  // The id is the contract, the text is the brand's: a whitelabel build overlays `core.json` with the
  // brand's own catalogue, so the entry's TEXT legitimately diverges from the base's generic
  // `defaultMessage` while the id must not. Asserting text equality here would fail every generated
  // repository, and this spec ships inside them.
  it('covers every declared id in core.json', () => {
    descriptors.forEach((descriptor) => {
      const id = descriptor.id as string;
      expect(Object.prototype.hasOwnProperty.call(catalogue, id)).toBe(true);
    });
  });

  it('has no core.json entry without a matching declared message', () => {
    const declaredIds = new Set(descriptors.map((descriptor) => descriptor.id));
    const orphanedInCatalogue = Object.keys(catalogue).filter(
      (id) => !declaredIds.has(id)
    );
    expect(orphanedInCatalogue).toEqual([]);
  });
});
