import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnzerMethodBuilder, UnzerMethodComponent } from '../src/components/unzer/unzer-method';
import { PaymentMethodView } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';
import { makeBaseOptions } from './helpers';

/**
 * What the HOST learns when a per-method surface cannot be rendered. A mount that fails must say so
 * through `onError` at mount time: the host decides what to show instead, and a shopper who is left
 * looking at an empty payment step learns nothing from a browser-console warning.
 */
describe('UnzerMethodComponent mount failures', () => {
  let host: HTMLDivElement;

  // `makeBaseOptions` mounts under the en-GB config, so this is the dictionary the component reports from.
  const texts = resolveShopperTexts('en-GB');

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'method';
    document.body.appendChild(host);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  const build = (code: string) => {
    const method: PaymentMethodView = {
      code,
      name: 'Some method',
      description: '',
      surcharge: 0,
      requiresCustomerData: false,
    };
    const { baseOptions, onError } = makeBaseOptions();
    const builder = new UnzerMethodBuilder(baseOptions, method);
    return { component: builder.build({}) as UnzerMethodComponent, onError };
  };

  // A method code with no entry in UNZER_METHOD_ELEMENTS has no vendor element to mount. The bail is a
  // config gap, not a shopper error, but the host is the only party that can react to it.
  /**
   * An unmapped code renders NOTHING and tells the HOST. The host callback is the surface that matters: a
   * console line reaches only a developer's browser and would leave the shopper an empty payment step
   * until they pressed Pay. Since then the case is also unreachable in production - the processor
   * never offers a code with no element - so this pins the library's own contract, not a live path.
   */
  it('reports an unmapped payment method to the host and renders nothing', async () => {
    const { component, onError } = build('no-such-method');

    await component.mount('#method');

    expect(host.querySelector('unzer-payment')).toBeNull();
    expect(onError).toHaveBeenCalledWith(texts.formLoadFailed);
  });

  // A mapped tag the vendor bundle never registers — a method the current SDK version dropped or
  // renamed — leaves `customElements.whenDefined` pending for as long as the page lives. No element is
  // registered in this suite, so the wait can only end at its deadline.
  it('reports a vendor element that is never registered rather than waiting for it forever', async () => {
    jest.useFakeTimers();
    const { component, onError } = build('card');

    const mounted = component.mount('#method');
    await jest.advanceTimersByTimeAsync(15_000);
    await mounted;

    expect(onError).toHaveBeenCalledWith(texts.formLoadFailed);
  });
});
