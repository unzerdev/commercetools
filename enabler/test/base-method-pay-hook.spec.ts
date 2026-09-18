import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnzerMethodBuilder, UnzerMethodComponent } from '../src/components/unzer/unzer-method';
import { PaymentMethodView } from '../src/payment-enabler/payment-config';
import { FetchMock, flushPromises, installFetchMock, makeBaseOptions, okJson } from './helpers';

/**
 * `ComponentOptions.onPayButtonClick` - the host's say before a charge the VENDOR started.
 *
 * Awaited on the vendor-driven path only (a wallet sheet the shopper paid from). A host that calls `submit()`
 * has already decided to pay, and commercetools Checkout's own hook STARTS Checkout's transaction: a `submit()`
 * Checkout itself issued is already inside that transaction, so awaiting the hook there deadlocked the page.
 */
class UnzerPaymentStub extends HTMLElement {
  static lastGooglePayData: Record<string, unknown> = {};

  setGooglePayData(data: Record<string, unknown>): void {
    UnzerPaymentStub.lastGooglePayData = data;
  }
}

type SubmitResult = { submitResponse: { success: boolean; data: { id: string } } };

/** The vendor's checkout element: a click on its enabled child control makes it report through `onPaymentSubmit`. */
class UnzerCheckoutStub extends HTMLElement {
  static nextResult: SubmitResult | null = { submitResponse: { success: true, data: { id: 'res-1' } } };
  onPaymentSubmit?: (result: SubmitResult) => void;

  connectedCallback(): void {
    this.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || target.disabled || !target.hasAttribute('data-unzer-submit')) {
        return;
      }
      const result = UnzerCheckoutStub.nextResult;
      if (result) {
        queueMicrotask(() => this.onPaymentSubmit?.(result));
      }
    });
  }
}

const cardMethod: PaymentMethodView = {
  code: 'card',
  name: 'Credit card',
  description: '',
  surcharge: 0,
  requiresCustomerData: false,
};

const googlePay: PaymentMethodView = {
  ...cardMethod,
  code: 'googlepay',
  name: 'Google Pay',
  rendersOwnPayButton: true,
  wallet: { kind: 'googlepay', payload: {} },
};

describe('UnzerBaseMethodComponent - onPayButtonClick', () => {
  let host: HTMLDivElement;
  let fetchMock: FetchMock;

  beforeAll(() => {
    if (!customElements.get('unzer-payment')) {
      customElements.define('unzer-payment', UnzerPaymentStub);
    }
    if (!customElements.get('unzer-checkout')) {
      customElements.define('unzer-checkout', UnzerCheckoutStub);
    }
    for (const tag of ['unzer-card', 'unzer-google-pay']) {
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
    fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));
    UnzerCheckoutStub.nextResult = { submitResponse: { success: true, data: { id: 'res-1' } } };
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  const mounted = async (hook: () => Promise<void>, method: PaymentMethodView = cardMethod) => {
    const { baseOptions, onError } = makeBaseOptions();
    const component = new UnzerMethodBuilder(baseOptions, method).build({
      onPayButtonClick: hook,
    }) as UnzerMethodComponent;
    await component.mount('#method');
    return { component, onError };
  };

  const checkoutEl = () => host.querySelector('unzer-checkout') as UnzerCheckoutStub;

  it('a host-driven submit never calls the hook and still posts', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { component } = await mounted(hook);

    await component.submit();

    expect(hook).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Checkout's hook resolves only once ITS transaction ends, and the transaction ends only once we post: a
  // submit() that waited on the hook waited forever.
  it('a hook that never resolves does not hang a host-driven submit', async () => {
    const hook = jest.fn<() => Promise<void>>(() => new Promise(() => {}));
    const { component } = await mounted(hook);

    await component.submit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('awaits the hook before POST /payments when the vendor submitted on its own', async () => {
    const order: string[] = [];
    const hook = jest.fn<() => Promise<void>>(async () => {
      order.push('hook');
    });
    fetchMock.mockImplementation(async () => {
      order.push('post');
      return okJson({ paymentReference: 'pay-1', action: { kind: 'none' } });
    });
    await mounted(hook);

    checkoutEl().onPaymentSubmit!({ submitResponse: { success: true, data: { id: 'res-1' } } });
    await flushPromises();

    expect(order).toEqual(['hook', 'post']);
  });

  it('a wallet sheet report is the vendor-driven path and asks the hook', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);

    checkoutEl().onPaymentSubmit!({ submitResponse: { success: true, data: { id: 'res-1' } } });
    await flushPromises();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a rejecting hook posts nothing, reports nothing and leaves the surface usable', async () => {
    let allow = false;
    const { onError } = await mounted(async () => {
      if (!allow) {
        throw new Error('host refused');
      }
    });

    checkoutEl().onPaymentSubmit!({ submitResponse: { success: true, data: { id: 'res-1' } } });
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    allow = true;
    checkoutEl().onPaymentSubmit!({ submitResponse: { success: true, data: { id: 'res-1' } } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * THE WALLET CLICK. Apple's and Google's sheets open from the button the vendor draws, and the host must
   * have its say BEFORE one opens: a shopper who has not accepted Checkout's terms has to meet that message
   * rather than a sheet that cannot pay. So the surface cancels the first click, asks `onPayButtonClick`, and
   * replays the click only on a yes - which is what these specs read, by watching whether a listener the
   * vendor could have registered inside the wallet element ever ran.
   */
  const walletButton = (): { button: HTMLElement; opened: jest.Mock<(event: Event) => void> } => {
    const walletEl = host.querySelector('unzer-google-pay') as HTMLElement;
    const button = document.createElement('button');
    const opened = jest.fn<(event: Event) => void>();
    button.addEventListener('click', (event) => opened(event));
    walletEl.appendChild(button);
    return { button, opened };
  };

  /** The shopper's own press, returned so a spec can tell it apart from the replay the gate sends. */
  const press = (button: HTMLElement): Event => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    button.dispatchEvent(event);
    return event;
  };

  const report = (): void => {
    checkoutEl().onPaymentSubmit!({ submitResponse: { success: true, data: { id: 'res-1' } } });
  };

  it('cancels the first wallet click, asks the host, and opens the sheet only once it agrees', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    press(button);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();

    await flushPromises();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet shut when the host refuses, and posts nothing', async () => {
    const hook = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('host refused'));
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    press(button);
    await flushPromises();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks again on the click that follows a refusal, so a shopper who fixes it can pay', async () => {
    let allow = false;
    const hook = jest.fn<() => Promise<void>>(async () => {
      if (!allow) {
        throw new Error('host refused');
      }
    });
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    press(button);
    await flushPromises();
    expect(opened).not.toHaveBeenCalled();

    allow = true;
    press(button);
    await flushPromises();

    expect(hook).toHaveBeenCalledTimes(2);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('asks the host once per wallet payment: the click asks, the vendor report does not ask again', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);
    const { button } = walletButton();

    press(button);
    await flushPromises();
    report();
    await flushPromises();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows the click once the surface has paid, so one tokenization cannot be spent twice', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();
    press(button);
    await flushPromises();
    report();
    await flushPromises();
    jest.clearAllMocks();

    press(button);
    await flushPromises();

    expect(hook).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('treats a host that never answers as a refusal, and says so because nothing else would', async () => {
    jest.useFakeTimers();
    try {
      const hook = jest.fn<() => Promise<void>>(() => new Promise(() => {}));
      const { onError } = await mounted(hook, googlePay);
      const { button, opened } = walletButton();

      press(button);
      await jest.advanceTimersByTimeAsync(10_000);

      expect(opened).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Each ask starts a Checkout transaction, so an impatient double tap must not start two.
  it('asks the host once while it is still answering, however many times the shopper taps', async () => {
    let settle: () => void = () => {};
    const hook = jest.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    press(button);
    press(button);
    press(button);

    expect(hook).toHaveBeenCalledTimes(1);

    settle();
    await flushPromises();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  // Dismissing a sheet and pressing again must reopen it on the approval already granted: a second ask
  // would start a second Checkout transaction for one payment. This is also what the identity replay buys -
  // a flag raised before a dispatch that never landed would instead let an unasked click reach the vendor.
  it('reopens the sheet on the held approval instead of asking the host a second time', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    press(button);
    await flushPromises();
    expect(opened).toHaveBeenCalledTimes(1);

    press(button);
    await flushPromises();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledTimes(2);
  });

  // The deadline timer is cleared once the host answers: a timer left armed would fire over a sheet the
  // shopper is still paying in.
  it('leaves no timer armed once the host has answered', async () => {
    jest.useFakeTimers();
    try {
      const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      await mounted(hook, googlePay);
      const { button, opened } = walletButton();

      press(button);
      await jest.advanceTimersByTimeAsync(0);

      expect(opened).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // The gate recognises its replay BY IDENTITY rather than by a flag, and this is the difference: the
  // shopper's own event is always cancelled and never reaches the vendor. A flag raised before a dispatch
  // that never landed would stay raised, and the press after it would arrive at the vendor unasked.
  it('never lets the shopper’s own event reach the vendor, only the replay it sent', async () => {
    const hook = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await mounted(hook, googlePay);
    const { button, opened } = walletButton();

    const shopperEvent = press(button);
    await flushPromises();

    expect(shopperEvent.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]![0]).not.toBe(shopperEvent);

    const secondEvent = press(button);
    await flushPromises();

    expect(secondEvent.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[1]![0]).not.toBe(secondEvent);
  });

  it('says nothing of its own when the host refuses, because the host raises its own message', async () => {
    const hook = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('host refused'));
    const { onError } = await mounted(hook, googlePay);
    const { button } = walletButton();

    press(button);
    await flushPromises();

    expect(onError).not.toHaveBeenCalled();
  });

  it('a refused click posts nothing when the vendor reports anyway', async () => {
    const hook = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('host refused'));
    await mounted(hook, googlePay);
    const { button } = walletButton();

    press(button);
    await flushPromises();
    report();
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
