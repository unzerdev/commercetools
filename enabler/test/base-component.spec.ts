import { describe, expect, it } from '@jest/globals';
import { BaseComponent } from '../src/components/base';
import { ComponentOptions, PaymentResult } from '../src/payment-enabler/payment-enabler';
import { BaseOptions } from '../src/payment-enabler/payment-enabler-psp';
import { makeBaseOptions } from './helpers';

// A minimal concrete component to exercise the protected wiring BaseComponent sets up from BaseOptions.
class TestComponent extends BaseComponent {
  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(baseOptions, componentOptions);
  }

  async mount(): Promise<void> {}

  async submit(): Promise<void> {}

  fireError(message: string, ref?: string) {
    this.onError(message, ref ? { paymentReference: ref } : undefined);
  }

  fireComplete(result: PaymentResult) {
    this.onComplete(result);
  }
}

describe('BaseComponent', () => {
  it('propagates onError from BaseOptions', () => {
    const { baseOptions, onError } = makeBaseOptions();
    const component = new TestComponent(baseOptions, {});
    component.fireError('boom', 'pay-1');
    expect(onError).toHaveBeenCalledWith('boom', { paymentReference: 'pay-1' });
  });

  it('propagates onComplete from BaseOptions', () => {
    const { baseOptions, onComplete } = makeBaseOptions();
    const component = new TestComponent(baseOptions, {});
    component.fireComplete({ isSuccess: true, paymentReference: 'pay-1' });
    expect(onComplete).toHaveBeenCalledWith({ isSuccess: true, paymentReference: 'pay-1' });
  });
});
