import {
  ActionRequired,
  ComponentOptions,
  PaymentComponent,
  PaymentComponentState,
  PaymentResult,
} from '../payment-enabler/payment-enabler';
import { BaseOptions } from '../payment-enabler/payment-enabler-psp';
import { ShopperTexts } from '../locale';

/**
 * Base for a per-method payment component: it wires the processor endpoint, the session credential and
 * the host callbacks from `BaseOptions`, and exposes the shopper-safe payment config the concrete
 * component reads (public key, locale). The payment method itself is a
 * config-driven `code`, so no vendor method enum is carried here.
 */
export abstract class BaseComponent implements PaymentComponent {
  protected processorUrl: BaseOptions['processorUrl'];
  protected sessionId: BaseOptions['sessionId'];
  protected locale?: BaseOptions['locale'];
  protected config: BaseOptions['config'];
  /** The enabler's own shopper strings, already resolved to the config's (i.e. the cart's) locale. */
  protected texts: ShopperTexts;
  /** The per-mount options Checkout passes (e.g. `showPayButton`); the concrete component reads them. */
  protected componentOptions: ComponentOptions;
  protected onComplete: (result: PaymentResult) => void;
  protected onError: (error: any, context?: { paymentReference?: string }) => void;
  protected onActionRequired?: (action: ActionRequired) => void;
  protected onPaymentProcessing?: () => void;

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    this.processorUrl = baseOptions.processorUrl;
    this.sessionId = baseOptions.sessionId;
    this.locale = baseOptions.locale;
    this.config = baseOptions.config;
    this.texts = baseOptions.texts;
    this.componentOptions = componentOptions;
    this.onComplete = baseOptions.onComplete;
    this.onError = baseOptions.onError;
    this.onActionRequired = baseOptions.onActionRequired;
    this.onPaymentProcessing = baseOptions.onPaymentProcessing;
  }

  abstract submit(): Promise<void>;

  abstract mount(selector: string): Promise<void>;

  showValidation?(): Promise<void>;
  isValid?(): Promise<boolean>;
  getState?(): Promise<PaymentComponentState>;
  isAvailable?(): Promise<boolean>;
}
