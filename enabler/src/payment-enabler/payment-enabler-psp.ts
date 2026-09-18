import {
  ActionRequired,
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentExpressBuilder,
  PaymentResult,
} from './payment-enabler';
import { parsePaymentConfig, PaymentConfig } from './payment-config';
import { resolveShopperTexts, ShopperTexts } from '../locale';
import { UNZER_METHOD_ELEMENTS, UnzerMethodBuilder } from '../components/unzer/unzer-method';
import {
  UNZER_COMPOSITE_TYPE,
  UnzerEmbeddedDropinBuilder,
  UnzerMethodListBuilder,
} from '../components/unzer/method-list';
import { loadUnzerSdk } from '../components/unzer/sdk';

/**
 * How long setup waits on the processor before giving up.
 *
 * The SDK load has had a deadline since it was written; the config read had none, so a processor that
 * accepted the connection and then hung left `setupData` pending for as long as the page lived - a
 * checkout spinning with no error and no retry path. The budget is deliberately generous: it is the
 * bound on a hang, not a latency target.
 *
 * It covers the READ only. `POST /payments` must never be aborted: an aborted charge is precisely the
 * case where the money may have moved with nothing local to record it, which is the whole reason
 * `postPaymentAndFollowUp` treats any 2xx as spent.
 */
const SETUP_TIMEOUT_MS = 15000;

/** `AbortSignal.timeout` where the runtime has it; a browser without it simply waits as before. */
const setupSignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(SETUP_TIMEOUT_MS)
    : undefined;

export type BaseOptions = {
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error: any, context?: { paymentReference?: string }) => void;
  onActionRequired?: (action: ActionRequired) => void;
  /** Fired once, per attempt, just before `POST /payments` - see `EnablerOptions.onPaymentProcessing`. */
  onPaymentProcessing?: () => void;
  // The shopper-safe payment config fetched from the processor on setup (public key, locale, the
  // enabled cart-eligible methods). Builders read it to render the methods.
  config: PaymentConfig;
  /**
   * The enabler's own shopper strings, resolved ONCE from the config's locale — which is the SESSION
   * CART's locale, the authoritative display language. Deliberately NOT resolved from
   * `locale` above: a host-supplied locale governs the vendor customer's language on the payment
   * request, never what this library renders.
   */
  texts: ShopperTexts;
};

/**
 * The PSP payment enabler — the browser entry point Checkout consumes. On setup it fetches the
 * shopper-safe payment config (`GET /operations/payment-config`) and loads the Unzer UI Components v2
 * SDK, then builds one component per enabled method the config returns: `<unzer-payment>` →
 * `<unzer-{method}>` → `<unzer-checkout>`, tokenizing through Unzer and posting the resulting resource
 * id to `POST /payments`. The custom component type `unzer` (also reachable as the `embedded` drop-in)
 * renders that whole method list itself and mounts the chosen method's component under the row the
 * shopper picked - the one integration commercetools Checkout needs.
 */
export class PspPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = PspPaymentEnabler._Setup(options);
  }

  private static _Setup = async (options: EnablerOptions): Promise<{ baseOptions: BaseOptions }> => {
    // Normalize the processor base URL once so every request path concatenates against a slash-free
    // base — a caller-supplied trailing slash would otherwise yield `//path`. Every downstream call
    // site (payment-config, payments) appends a leading-slash path.
    const processorUrl = options.processorUrl.replace(/\/$/, '');

    // Fetch the shopper-facing payment config (never secrets beyond the public key). Its presence
    // proves the session is valid before any component is built.
    const configResponse = await fetch(processorUrl + '/operations/payment-config', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': options.sessionId,
      },
      signal: setupSignal(),
    });

    if (!configResponse.ok) {
      throw new Error(`Failed to fetch processor config (status ${configResponse.status}).`);
    }

    // Parse fail-soft so a sparse body never crashes setup.
    const config = parsePaymentConfig(await configResponse.json());

    // The SDK must register its custom elements before any component mounts.
    await loadUnzerSdk();

    return {
      baseOptions: {
        processorUrl,
        sessionId: options.sessionId,
        locale: options.locale,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
        onActionRequired: options.onActionRequired,
        onPaymentProcessing: options.onPaymentProcessing,
        config,
        texts: resolveShopperTexts(config.locale),
      },
    };
  };

  async createComponentBuilder(type: string): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;

    // The one type Checkout is offered: the whole MC-enabled method list, the shopper picking inside it.
    if (type === UNZER_COMPOSITE_TYPE) {
      return new UnzerMethodListBuilder(baseOptions);
    }

    const method = baseOptions.config.paymentMethods.find((m) => m.code === type);
    if (!method || !UNZER_METHOD_ELEMENTS[type]) {
      const available = baseOptions.config.paymentMethods
        .map((m) => m.code)
        .filter((code) => UNZER_METHOD_ELEMENTS[code])
        .join(', ');
      throw new Error(`Component type not supported: ${type}. Supported types: ${available}`);
    }

    return new UnzerMethodBuilder(baseOptions, method);
  }

  // The same method list under the drop-in contract, for a storefront that mounts drop-ins; the hosted-page
  // types are refused with a clear error, not a crash, so a host probing the standard surface learns why.
  async createDropinBuilder(type: DropinType): Promise<PaymentDropinBuilder | never> {
    const { baseOptions } = await this.setupData;
    if (type === DropinType.embedded) {
      return new UnzerEmbeddedDropinBuilder(baseOptions);
    }
    throw new Error(
      `Dropin type not supported: ${type}. This connector renders the embedded drop-in and per-method components.`,
    );
  }

  async createExpressBuilder(type: string): Promise<PaymentExpressBuilder | never> {
    throw new Error(`Express checkout type not supported: ${type}. This connector has no express components.`);
  }
}
