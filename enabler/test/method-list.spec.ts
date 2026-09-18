import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  methodLogoUrl,
  UNZER_COMPOSITE_TYPE,
  UnzerEmbeddedDropinBuilder,
  UnzerMethodListBuilder,
} from '../src/components/unzer/method-list';
import { PaymentConfig, PaymentMethodView } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';
import {
  errorResponse,
  FetchMock,
  flushPromises,
  installFetchMock,
  makeBaseOptions,
  okJson,
  readCall,
} from './helpers';

/**
 * The embedded drop-in: the store's method list rendered by the connector, one mount host under the chosen
 * row, the per-method component built and mounted there. What these cases pin is the LIST and the LIFECYCLE -
 * order, rows, selection, teardown, locking, delegation; the per-method surface itself is `unzer-method.spec.ts`.
 */
class UnzerPaymentStub extends HTMLElement {}

type SubmitResult = { submitResponse: { success: boolean; data: { id: string } } };

/** The vendor's checkout element: a click on its enabled hidden control makes it report through `onPaymentSubmit`. */
class UnzerCheckoutStub extends HTMLElement {
  static nextResult: SubmitResult = { submitResponse: { success: true, data: { id: 'res-1' } } };
  onPaymentSubmit?: (result: SubmitResult) => void;

  connectedCallback(): void {
    this.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || target.disabled || !target.hasAttribute('data-unzer-submit')) {
        return;
      }
      const result = UnzerCheckoutStub.nextResult;
      queueMicrotask(() => this.onPaymentSubmit?.(result));
    });
  }
}

const defineUnzerElements = () => {
  if (!customElements.get('unzer-payment')) {
    customElements.define('unzer-payment', UnzerPaymentStub);
  }
  if (!customElements.get('unzer-checkout')) {
    customElements.define('unzer-checkout', UnzerCheckoutStub);
  }
  for (const tag of ['unzer-card', 'unzer-paypal', 'unzer-paylater-invoice', 'unzer-customer-form']) {
    if (!customElements.get(tag)) {
      customElements.define(tag, class extends HTMLElement {});
    }
  }
};

const method = (over: Partial<PaymentMethodView> & { code: string }): PaymentMethodView => ({
  name: over.code,
  description: '',
  surcharge: 0,
  requiresCustomerData: false,
  ...over,
});

const card = method({
  code: 'card',
  name: 'Credit card',
  description: 'Pay by card',
  logo: '/assets/method-logo/card',
});
const paypal = method({
  code: 'paypal',
  name: 'PayPal',
  rendersOwnPayButton: true,
  logo: 'https://cdn.example/paypal.svg',
});
const invoice = method({ code: 'paylater-invoice', name: 'Invoice', surcharge: 150, requiresCustomerData: true });

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

describe('UnzerMethodListComponent', () => {
  let host: HTMLDivElement;
  let fetchMock: FetchMock;

  beforeAll(defineUnzerElements);

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'dropin';
    document.body.appendChild(host);
    fetchMock = installFetchMock();
    UnzerCheckoutStub.nextResult = { submitResponse: { success: true, data: { id: 'res-1' } } };
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  // Checkout builds the list as the custom component `unzer`; a storefront may take the drop-in contract. Both
  // hand out the same component, so the lifecycle cases below run through the component builder.
  const build = (methods: PaymentMethodView[], over: Parameters<typeof makeBaseOptions>[0] = {}) => {
    const made = makeBaseOptions({ config: config(methods), ...over });
    const dropin = new UnzerMethodListBuilder(made.baseOptions).build({});
    return { ...made, dropin };
  };

  const rows = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-unzer-method-row]'));
  const rowFor = (code: string) => host.querySelector<HTMLButtonElement>(`[data-unzer-method-row="${code}"]`)!;
  const click = (code: string) => rowFor(code).dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it('renders one row per method in processor order, with logo, name, surcharge suffix and description', async () => {
    const { dropin } = build([card, paypal, invoice]);
    await dropin.mount('#dropin');

    expect(rows().map((row) => row.getAttribute('data-unzer-method-row'))).toEqual([
      'card',
      'paypal',
      'paylater-invoice',
    ]);
    expect(rowFor('card').querySelector('img')!.getAttribute('src')).toBe(
      'https://proc.example/assets/method-logo/card',
    );
    expect(rowFor('card').querySelector('img')!.getAttribute('alt')).toBe('Credit card');
    expect(rowFor('card').textContent).toContain('Credit card');
    expect(rowFor('card').textContent).toContain('Pay by card');
    expect(rowFor('paylater-invoice').textContent).toContain('(+€1.50)');
    expect(rowFor('paypal').querySelector('img')!.getAttribute('src')).toBe('https://cdn.example/paypal.svg');
    // Nothing is mounted before a pick: the host is present, hidden and empty.
    const methodHost = host.querySelector<HTMLElement>('[data-unzer-method-host]')!;
    expect(methodHost.hidden).toBe(true);
    expect(methodHost.children).toHaveLength(0);
  });

  it('omits the <img> when the processor sent no logo', async () => {
    const { dropin } = build([invoice]);
    await dropin.mount('#dropin');

    expect(rowFor('paylater-invoice').querySelector('img')).toBeNull();
  });

  it('renders the localized notice and no rows for an empty method list', async () => {
    const { dropin, baseOptions } = build([]);
    await dropin.mount('#dropin');

    expect(rows()).toHaveLength(0);
    expect(host.querySelector('[data-unzer-no-methods]')!.textContent).toBe(baseOptions.texts.noPaymentMethods);
    expect(baseOptions.texts.noPaymentMethods).toBe(resolveShopperTexts('en-GB').noPaymentMethods);
  });

  it('submit with nothing selected reports paymentInitFailed and posts nothing', async () => {
    const { dropin, onError, baseOptions } = build([card, paypal]);
    await dropin.mount('#dropin');

    await dropin.submit();

    expect(onError).toHaveBeenCalledWith(baseOptions.texts.paymentInitFailed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('selecting a row mounts the method surface, with its hidden submit control, directly under THAT row', async () => {
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');

    click('card');
    await flushPromises();

    const methodHost = host.querySelector<HTMLElement>('[data-unzer-method-host]')!;
    expect(rowFor('card').nextElementSibling).toBe(methodHost);
    expect(rowFor('card').hasAttribute('data-unzer-selected')).toBe(true);
    expect(rowFor('card').getAttribute('aria-checked')).toBe('true');
    expect(rowFor('paypal').hasAttribute('data-unzer-selected')).toBe(false);
    expect(methodHost.hidden).toBe(false);
    expect(methodHost.querySelector('unzer-payment unzer-card')).not.toBeNull();
    expect(methodHost.querySelector('unzer-checkout [data-unzer-submit][hidden]')).not.toBeNull();
    expect(methodHost.querySelector('[data-unzer-pay]')).toBeNull();
  });

  it('selecting another row clears the previous surface and re-mounts under the new row', async () => {
    const { dropin } = build([card, invoice]);
    await dropin.mount('#dropin');

    click('card');
    await flushPromises();
    click('paylater-invoice');
    await flushPromises();

    expect(host.querySelectorAll('unzer-payment')).toHaveLength(1);
    expect(host.querySelector('unzer-card')).toBeNull();
    expect(host.querySelector('unzer-paylater-invoice')).not.toBeNull();
    expect(rowFor('paylater-invoice').nextElementSibling).toBe(host.querySelector('[data-unzer-method-host]'));
    expect(rowFor('card').hasAttribute('data-unzer-selected')).toBe(false);
  });

  it('re-clicking the selected row is a no-op', async () => {
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');

    click('card');
    await flushPromises();
    const surface = host.querySelector('unzer-payment');
    click('card');
    await flushPromises();

    expect(host.querySelector('unzer-payment')).toBe(surface);
  });

  it('a rendersOwnPayButton method mounts no submit control: the vendor button pays', async () => {
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');

    click('paypal');
    await flushPromises();

    expect(host.querySelector('unzer-paypal')).not.toBeNull();
    expect(host.querySelector('[data-unzer-pay]')).toBeNull();
    expect(host.querySelector('[data-unzer-submit]')).toBeNull();
  });

  it('submit on a selected rendersOwnPayButton row names the vendor button and posts nothing', async () => {
    const { dropin, onError, baseOptions } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('paypal');
    await flushPromises();

    await dropin.submit();

    expect(onError).toHaveBeenCalledWith(baseOptions.texts.useVendorButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('showValidation marks the chosen row for attention and points at the vendor button', async () => {
    Element.prototype.scrollIntoView = jest.fn() as unknown as Element['scrollIntoView'];
    const { dropin, baseOptions } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('paypal');
    await flushPromises();

    await (dropin as unknown as { showValidation(): Promise<void> }).showValidation();

    expect(rowFor('paypal').hasAttribute('data-unzer-attention')).toBe(true);
    expect(rowFor('card').hasAttribute('data-unzer-attention')).toBe(false);
    expect(host.textContent).toContain(baseOptions.texts.useVendorButton);
  });

  it('choosing another method clears the attention mark the previous validation left', async () => {
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('paypal');
    await flushPromises();
    await (dropin as unknown as { showValidation(): Promise<void> }).showValidation();

    click('card');
    await flushPromises();

    expect(rowFor('paypal').hasAttribute('data-unzer-attention')).toBe(false);
    expect(rowFor('card').hasAttribute('data-unzer-attention')).toBe(false);
  });

  it('isValid is false with nothing chosen and follows the chosen method after a pick', async () => {
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');
    const list = dropin as { isValid(): Promise<boolean> };

    await expect(list.isValid()).resolves.toBe(false);

    click('card');
    await flushPromises();
    await expect(list.isValid()).resolves.toBe(true);

    host.querySelector<HTMLButtonElement>('[data-unzer-submit]')!.disabled = true;
    await expect(list.isValid()).resolves.toBe(false);
  });

  it('submit delegates to the selected method, which posts that method to the processor', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const { dropin, onComplete } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('card');
    await flushPromises();

    await dropin.submit();

    const call = readCall(fetchMock, 0);
    expect(call.url).toBe('https://proc.example/payments');
    expect((call.body as { paymentMethodCode: string }).paymentMethodCode).toBe('card');
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ isSuccess: true, paymentReference: 'pay-1' }));
  });

  it('auto-selects a single offered method on mount', async () => {
    const { dropin } = build([card]);
    await dropin.mount('#dropin');

    expect(rowFor('card').hasAttribute('data-unzer-selected')).toBe(true);
    expect(host.querySelector('unzer-payment unzer-card')).not.toBeNull();
  });

  it('calls onDropinReady after rendering, and a rejecting hook does not fail the mount', async () => {
    const ready = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('host failed'));
    const { baseOptions } = makeBaseOptions({ config: config([card, paypal]) });
    const dropin = new UnzerEmbeddedDropinBuilder(baseOptions).build({ onDropinReady: ready });

    await expect(dropin.mount('#dropin')).resolves.toBeUndefined();

    expect(ready).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(2);
  });

  it('locks the rows once the charge is posted and keeps them locked on completion', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    const { dropin } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('card');
    await flushPromises();

    await dropin.submit();

    expect(rows().every((row) => row.disabled)).toBe(true);
    click('paypal');
    await flushPromises();
    expect(rowFor('card').hasAttribute('data-unzer-selected')).toBe(true);
  });

  it('unlocks the rows after a failure the shopper may retry', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500));
    const { dropin, onError } = build([card, paypal]);
    await dropin.mount('#dropin');
    click('card');
    await flushPromises();

    await dropin.submit();

    expect(onError).toHaveBeenCalled();
    expect(rows().some((row) => row.disabled)).toBe(false);
    click('paypal');
    await flushPromises();
    expect(rowFor('paypal').hasAttribute('data-unzer-selected')).toBe(true);
  });

  it('a missing mount target reports through onError and throws nothing', async () => {
    const { dropin, onError } = build([card]);

    await expect(dropin.mount('#nowhere')).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('#nowhere'));
  });

  it('both builders answer submit() and hand out the same list', async () => {
    const { baseOptions } = makeBaseOptions({ config: config([card, paypal]) });
    expect(new UnzerMethodListBuilder(baseOptions).componentHasSubmit).toBe(true);
    expect(new UnzerEmbeddedDropinBuilder(baseOptions).dropinHasSubmit).toBe(true);
    expect(UNZER_COMPOSITE_TYPE).toBe('unzer');

    await new UnzerEmbeddedDropinBuilder(baseOptions).build({}).mount('#dropin');
    expect(rows()).toHaveLength(2);
  });

  it('isAvailable answers whether the store offers any method', async () => {
    const { dropin: withMethods } = build([card]);
    const { dropin: withoutMethods } = build([]);
    await expect((withMethods as { isAvailable(): Promise<boolean> }).isAvailable()).resolves.toBe(true);
    await expect((withoutMethods as { isAvailable(): Promise<boolean> }).isAvailable()).resolves.toBe(false);
  });
});

describe('methodLogoUrl', () => {
  it('keeps an absolute URL, resolves a root-relative one against the processor, and yields nothing without a logo', () => {
    expect(methodLogoUrl(paypal, 'https://proc.example')).toBe('https://cdn.example/paypal.svg');
    expect(methodLogoUrl(card, 'https://proc.example')).toBe('https://proc.example/assets/method-logo/card');
    expect(methodLogoUrl(invoice, 'https://proc.example')).toBeUndefined();
  });
});
