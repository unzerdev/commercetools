import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { UnzerEmbeddedDropinBuilder } from '../src/components/unzer/method-list';
import { PaymentConfig, PaymentMethodView } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';
import { makeBaseOptions } from './helpers';

/**
 * The drop-in's list writes its rows through `insertAdjacentHTML`, so `src/html.ts` states the rule it follows:
 * a value becomes TEXT exactly once, where it becomes HTML. Every value the rows interpolate is driven with
 * markup here - the name and description an operator edits in the `mc` application, the logo URL the
 * processor serves, and the empty-list notice from the locale dictionary.
 */
describe('UnzerMethodListComponent template escaping', () => {
  let host: HTMLDivElement;

  const HOSTILE = '<img src=x onerror="alert(1)">';

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
    host.id = 'dropin';
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const config = (methods: PaymentMethodView[]): PaymentConfig => ({
    publicKey: 's-pub-1',
    environment: 'sandbox',
    locale: 'en-GB',
    currency: 'EUR',
    fractionDigits: 2,
    amount: 1000,
    customerType: 'B2C',
    paymentMethods: methods,
  });

  it('renders a markup-carrying name, description and logo as text and attribute values only', async () => {
    const methods: PaymentMethodView[] = [
      {
        code: 'card',
        name: HOSTILE,
        description: HOSTILE,
        surcharge: 0,
        requiresCustomerData: false,
        logo: `https://cdn.example/${HOSTILE}`,
      },
      { code: 'paypal', name: 'PayPal', description: '', surcharge: 0, requiresCustomerData: false },
    ];
    const { baseOptions } = makeBaseOptions({ config: config(methods) });

    await new UnzerEmbeddedDropinBuilder(baseOptions).build({}).mount('#dropin');

    // The only <img> is the logo, and its src is the hostile string as a URL VALUE (percent-encoded by the URL
    // parser on the way in), not as parsed markup.
    const images = host.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe(new URL(`https://cdn.example/${HOSTILE}`).toString());
    expect(images[0].getAttribute('src')).not.toContain('<');
    expect(images[0].getAttribute('onerror')).toBeNull();
    const row = host.querySelector('[data-unzer-method-row="card"]')!;
    expect(row.textContent).toContain(HOSTILE);
    expect(row.querySelector('[onerror]')).toBeNull();
  });

  it('renders a markup-carrying empty-list notice as text', async () => {
    const { baseOptions } = makeBaseOptions({
      config: config([]),
      texts: { ...resolveShopperTexts('en-GB'), noPaymentMethods: HOSTILE },
    });

    await new UnzerEmbeddedDropinBuilder(baseOptions).build({}).mount('#dropin');

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-unzer-no-methods]')!.textContent).toBe(HOSTILE);
  });
});
