/**
 * `UNZER_METHOD_ELEMENTS` against the module that OWNS the method-type codes.
 *
 * The map is keyed by the `paymentMethodCode` values `GET /operations/payment-config` returns, and the
 * processor takes those from the keypair catalogue whose codes `METHOD_TRANSACTION_SUPPORT` declares — it
 * normalizes neither the spelling nor the case on the way out. A key matching no catalogue code is
 * therefore unreachable, and the failure is the shopper's: `createComponentBuilder` refuses the method
 * with `Component type not supported: <code>`, and a host that mounts the surface anyway is told
 * `formLoadFailed`, so a shopper who selects that method is shown a failure instead of a form.
 *
 * The expected codes are READ from the authority rather than restated here, which is what makes a code the
 * connector gains, loses or renames fail this spec; a second hand-maintained copy of the catalogue is the
 * duplication that produced the divergence in the first place.
 *
 * The import is the ONLY place the enabler reaches into the processor: the one module the boundary
 * sanction names, in the one file it names. It reaches no further than this spec — `npm run build`
 * compiles `src` and never `test`, so nothing that runs in a browser resolves this path.
 */

import { describe, expect, it } from '@jest/globals';
import { COMPOSITE_COMPONENT_TYPE, OFFERABLE_METHOD_CODES } from '../../processor/src/providers/psp/methods';
import { UNZER_COMPOSITE_TYPE } from '../src/components/unzer/method-list';
import { UNZER_METHOD_ELEMENTS } from '../src/components/unzer/unzer-method';

const MAPPED_CODES = Object.keys(UNZER_METHOD_ELEMENTS);

/**
 * The two lists must be EQUAL, and the equality is the contract.
 *
 * `OFFERABLE_METHOD_CODES` is what the processor's catalogue boundary lets through, so it is exactly the
 * set of codes a shopper can be offered. A code offered with no element here reaches a checkout that then
 * answers `Component type not supported`; an element mapped for a code the boundary drops is dead weight
 * nothing can reach. Asserted in both directions against the single authority rather than against a second
 * hand-maintained list, which is the duplication that let the two drift apart in the first place.
 */
describe('UNZER_METHOD_ELEMENTS against the codes the connector offers', () => {
  it('maps only codes the connector actually offers, so every entry is reachable', () => {
    const unreachable = MAPPED_CODES.filter((code) => !OFFERABLE_METHOD_CODES.includes(code));

    expect(unreachable).toEqual([]);
  });

  it('maps EVERY code the connector offers, so no offered method reaches a checkout without a surface', () => {
    const unmapped = OFFERABLE_METHOD_CODES.filter((code) => !MAPPED_CODES.includes(code));

    expect(unmapped).toEqual([]);
  });

  // The one component type the processor advertises to Checkout must be the one the enabler builds.
  it('advertises the composite component under the name the enabler builds it', () => {
    expect(COMPOSITE_COMPONENT_TYPE).toBe(UNZER_COMPOSITE_TYPE);
  });
});
