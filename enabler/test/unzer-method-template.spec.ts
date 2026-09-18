import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnzerMethodBuilder, UnzerMethodComponent } from '../src/components/unzer/unzer-method';
import { PaymentMethodView } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';
import { makeBaseOptions } from './helpers';

/**
 * The per-method template writes its chrome through `insertAdjacentHTML`, so `src/html.ts` states the
 * boundary rule it follows: a value becomes TEXT exactly once, where it becomes HTML.
 * This pins that rule for the per-method surface.
 *
 * Two of the three values the template interpolates can carry markup, and both are driven here:
 * `method.name`, the per-language display name an operator edits in the `mc` application, and the
 * pay-button label, which the component reads off `BaseOptions.texts`. The third, the formatted
 * surcharge, is `Intl.NumberFormat` output over a number and carries none of the five characters
 * `escapeHtml` replaces for any locale or currency the formatter accepts; its escape applies the same rule
 * uniformly rather than guarding a reachable input, and no assertion here can tell it apart from its
 * absence.
 */
describe('UnzerMethodComponent template escaping', () => {
  let host: HTMLDivElement;

  // The markup an operator can type into the method's display name; the same string is driven through
  // the button label, whose dictionary entry reaches the component as `BaseOptions.texts`.
  const HOSTILE = '<img src=x onerror="alert(1)">';

  // The SDK registers these; stand-ins make `customElements.whenDefined(tag)` resolve so mount completes.
  beforeAll(() => {
    for (const tag of ['unzer-payment', 'unzer-card', 'unzer-checkout']) {
      if (!customElements.get(tag)) {
        customElements.define(tag, class extends HTMLElement {});
      }
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'method';
    document.body.appendChild(host);
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('renders no text of its own around the vendor form: no name, no label, an empty submit control', async () => {
    const method: PaymentMethodView = {
      code: 'card',
      name: HOSTILE,
      description: HOSTILE,
      surcharge: 0,
      requiresCustomerData: false,
    };
    const { baseOptions } = makeBaseOptions({ texts: resolveShopperTexts('en-GB') });
    const component = new UnzerMethodBuilder(baseOptions, method).build({
      showPayButton: true,
    }) as UnzerMethodComponent;

    await component.mount('#method');

    expect(host.querySelector('img')).toBeNull();
    // The surface restates neither the method name nor the description, so neither can be an injection
    // vector here - asserted as ABSENCE rather than dropped, because "we escape it" and "we never render it"
    // are different guarantees and only the second one is true now.
    expect(host.querySelector('[data-unzer-method-name]')).toBeNull();
    expect(host.textContent).not.toContain('injected');
    // The one control the surface adds carries no label at all: the host draws the button the shopper reads.
    expect(host.querySelector('[data-unzer-submit]')!.textContent).toBe('');
    expect(host.querySelector('[data-unzer-pay]')).toBeNull();
  });
});
