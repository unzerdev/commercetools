/**
 * Represents the payment enabler. The payment enabler is the entry point for creating the components.
 *
 * Usage:
 *    const enabler = new Enabler({
 *      processorUrl: __VITE_PROCESSOR_URL__,
 *      sessionId: sessionId,
 *      config: {
 *
 *      },
 *      onComplete: ({ isSuccess, paymentReference }) => {
 *        console.log('onComplete', { isSuccess, paymentReference });
 *      },
 *    });
 *
 *    enabler.createComponentBuilder('card')
 *      .then(builder => {
 *          const paymentElement = builder.build({
 *            showPayButton: false,
 *          });
 *          paymentElement.mount('#card-component')
 *      })
 *
 *    enabler.createComponentBuilder('invoice')
 *      .then(builder => {
 *          const paymentElement = builder.build({});
 *          paymentElement.mount('#invoice-component')
 *      })
 */

import type { ShopperPrefill } from './payment-config';
export interface PaymentEnabler {
  /**
   * Creates a payment component builder of the specified type.
   * @param type - The type of the payment component builder.
   * @returns A promise that resolves to the payment component builder.
   * @throws {Error} If the payment component builder cannot be created.
   */
  createComponentBuilder: (type: string) => Promise<PaymentComponentBuilder | never>;

  /**
   * Creates a payment drop-in builder of the specified type.
   * @param type - The type of the payment drop-in builder.
   * @returns A promise that resolves to the payment drop-in builder.
   * @throws {Error} If the payment drop-in builder cannot be created.
   */
  createDropinBuilder: (type: DropinType) => Promise<PaymentDropinBuilder | never>;

  /**
   * Creates an express payment builder of the specified type.
   * @param type - The type of the express payment builder.
   * @returns A promise that resolves to the express payment builder.
   * @throws {Error} If the express payment builder cannot be created.
   */
  createExpressBuilder: (type: string) => Promise<PaymentExpressBuilder | never>;
}

/**
 * Represents the interface for a payment component.
 */
export type PaymentComponentState = {
  card?: {
    endDigits?: string;
    brand?: string;
    expiryDate?: string;
  };
};

export interface PaymentComponent {
  /**
   * Mounts the payment component to the specified selector.
   * @param selector - The selector where the component will be mounted.
   */
  mount(selector: string): Promise<void>;

  /**
   * Submits the payment.
   */
  submit(): Promise<void>;

  /**
   * Shows the validation for the payment component.
   */
  showValidation?(): Promise<void>;

  /**
   * Checks if the payment component is valid.
   * @returns A boolean indicating whether the payment component is valid.
   */
  isValid?(): Promise<boolean>;

  /**
   * Gets the state of the payment component.
   * @returns An object representing the state of the payment component.
   */
  getState?(): Promise<PaymentComponentState>;

  /**
   * Checks if the payment component is available for use.
   * @returns A promise that resolves to a boolean indicating whether the payment component is available.
   */
  isAvailable?(): Promise<boolean>;
}

/**
 * Represents the interface for a payment component builder.
 */
export interface PaymentComponentBuilder {
  /**
   * Indicates whether the component has a submit action.
   */
  componentHasSubmit?: boolean;

  /**
   * Builds a payment component with the specified configuration.
   * @param config - The configuration options for the payment component.
   * @returns The built payment component.
   */
  build(config: ComponentOptions): PaymentComponent;
}

/**
 * Represents the options for the payment enabler.
 */
export type EnablerOptions = {
  /**
   * The URL of the payment processor.
   */
  processorUrl: string;

  /**
   * The session ID for the payment.
   */
  sessionId: string;

  /**
   * The locale for the payment.
   */
  locale?: string;

  /**
   * The country code for the payment.
   */
  countryCode?: string;

  /**
   * Called when the component is about to take the screen for a follow-up the shopper has to act on -
   * a challenge, or a navigation to the provider.
   *
   * The host is NOTIFIED, never asked. The call is not awaited and whatever it returns is discarded, so a
   * host that throws, rejects or never settles cannot decide whether a charge that already happened is
   * followed through: by the time this fires, `POST /payments` has answered and a commercetools Payment
   * exists. Do layout here (raise an overlay, give the component the viewport) and nothing else.
   *
   * The reference connectors' only call site is the same shape: their session-init module fires
   * `onActionRequired({ type: 'fullscreen' })`, unawaited, right before it renders a 3-D Secure challenge.
   */
  onActionRequired?: (action: ActionRequired) => void;

  /**
   * A callback function that is called once the shopper's input has been tokenized and the payment is
   * about to be sent to the processor (`POST /payments`). It is the first moment the host can be sure the
   * attempt left the vendor surface, so a host that blocks its page for the wait should do it here rather
   * than on the pay click - while the vendor element is still validating and tokenizing it runs a spinner
   * of its own inside its iframe, and a host overlay raised at click time collides with it.
   */
  onPaymentProcessing?: () => void;

  /**
   * A callback function that is called when the payment is completed.
   * @param result - The result of the payment.
   */
  onComplete?: (result: PaymentResult) => void;

  /**
   * A callback function that is called when an error occurs during the payment process.
   * @param error - The error that occurred.
   * @param paymentReference - The payment reference.
   */
  onError?: (error: any, context?: { paymentReference?: string }) => void;
};

/**
 * WHAT THE HOST PAGE'S URL COMMITS TO. Every charge this library posts carries
 * `returnUrl: window.location.href` - the address the shopper must come back to after a redirect or a 3DS
 * challenge - and the processor stores it on the commercetools Payment so its own `/return` leg can
 * rebuild it. So the checkout URL, QUERY INCLUDED, is persisted alongside the payment. A host that keeps
 * anything private in that query (a token, an email, an order reference someone else must not read) is
 * keeping it in the payment record too, and should carry that state somewhere other than the URL.
 */

/**
 * Represents the result of a payment.
 */
export type PaymentResult =
  | {
      /**
       * Indicates whether the payment was successful.
       */
      isSuccess: true;

      /**
       * The payment reference.
       */
      paymentReference: string;

      /**
       * What the shopper must still be TOLD, for a method that takes no money at checkout.
       *
       * Prepayment and Invoice answer with an account and a reference instead of a settlement: the shopper
       * transfers the amount themselves, so a checkout that drops this leaves them with an order they cannot
       * pay. `instruction` names the shape (`bank-transfer` today) and the rest are its values - `holder`,
       * `iban`, `bic`, `descriptor`, `shortId` - carried verbatim from the processor, which read them off the
       * vendor's answer. Absent for every method that settles at checkout.
       */
      display?: Record<string, unknown>;
    }
  | {
      /**
       * Indicates whether the payment was unsuccessful.
       */
      isSuccess: false;

      /**
       * The payment reference.
       */
      paymentReference?: string;
    };

/**
 * Represents the options for a payment component.
 */
export type ComponentOptions = {
  /**
   * Accepted for contract compatibility and ignored: this connector never renders a pay button of its own.
   * The host draws the button and calls `submit()`; a wallet draws the vendor's.
   */
  showPayButton?: boolean;

  /**
   * A callback function that is called when the VENDOR's own button started a payment (a wallet sheet).
   * A payment the host started through `submit()` does not consult it: the host already decided.
   * @returns A Promise indicating whether the payment should proceed.
   */
  onPayButtonClick?: () => Promise<void>;

  /**
   * Customer data the HOST collected, merged OVER the prefill the processor sent, field by field.
   *
   * It exists for the data commercetools has nowhere to keep. A DATE OF BIRTH is the case that forced it:
   * the platform carries one only on a registered Customer, so a guest checkout that asks for it has
   * nowhere to put the answer, and the buy-now-pay-later methods are refused without one
   * (`COR.100.301.112`). A storefront that asks the shopper directly can hand it over here.
   *
   * MERGED and not replacing: the processor's prefill is what the platform knows, and a host that supplies
   * one field must not silently blank the rest. Every field is optional for the same reason a missing
   * prefill field is dropped rather than sent empty — an empty value reads as an ANSWER to the vendor form
   * and stops it asking the shopper the question.
   */
  customer?: Partial<ShopperPrefill>;
};

/**
 * What a component is about to do to the screen when it notifies `onActionRequired`.
 *
 * `fullscreen` is the only value the reference connectors emit, so it is the only one a host is known to
 * handle; `type` is required rather than optional because a notification that does not say what is coming
 * tells the host nothing it can act on.
 */
export type ActionRequired = { type: 'fullscreen' };

/**
 * Represents the payment drop-in types.
 */
export enum DropinType {
  /*
   * The embedded drop-in type which is rendered within the page.
   */
  embedded = 'embedded',
  /*
   * The hosted payment page (HPP) drop-in type which redirects the user to a hosted payment page.
   */
  hpp = 'hpp',
  /*
   * HPP preselected: the merchant renders the enabled payment-method buttons and each button starts a
   * provider hosted checkout scoped to that method (the shopper picks the method before the redirect).
   */
  hppPreselected = 'hpp-preselected',
}

/**
 * Represents the interface for a drop-in component.
 */
export interface DropinComponent {
  /**
   * Submits the drop-in component.
   */
  submit(): Promise<void>;

  /**
   * Mounts the drop-in component to the specified selector.
   * @param selector - The selector where the drop-in component will be mounted.
   */
  mount(selector: string): Promise<void>;
}

/**
 * Represents the options for a drop-in component.
 */
export type DropinOptions = {
  /**
   * Accepted for contract compatibility and ignored: this connector never renders a pay button of its own.
   * The host draws the button and calls `submit()`; a wallet draws the vendor's.
   **/
  showPayButton?: boolean;

  /**
   * A callback function that is called when the drop-in component is ready.
   * @returns A Promise indicating whether the drop-in component is ready.
   */
  onDropinReady?: () => Promise<void>;

  /**
   * A callback function that is called when the VENDOR's own button started a payment (a wallet sheet).
   * A payment the host started through `submit()` does not consult it: the host already decided.
   * @returns A Promise indicating whether the payment should proceed.
   */
  onPayButtonClick?: () => Promise<void>;
};

/**
 * Represents the interface for a payment drop-in builder.
 */
export interface PaymentDropinBuilder {
  /**
   * Indicates whether the drop-in component has a submit action.
   */
  dropinHasSubmit: boolean;

  /**
   * Builds a drop-in component with the specified configuration.
   * @param config - The configuration options for the drop-in component.
   * @returns The built drop-in component.
   */
  build(config: DropinOptions): DropinComponent;
}

export interface ExpressComponent {
  mount(selector: string): void;
}

export type ExpressAddressData = {
  country: string;
  firstName?: string;
  lastName?: string;
  streetName?: string;
  streetNumber?: string;
  additionalStreetInfo?: string;
  region?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
};

type OnclickResponse = {
  sessionId: string;
};

export type OnComplete = (opts: {
  isSuccess: boolean;
  paymentReference: string;
  method: {
    type: string;
  };
}) => void;

export type CTAmount = {
  centAmount: number;
  currencyCode: string;
  fractionDigits: number;
};

// ExpressShippingOptionData can be structured to meet the type contract of the PSP implemented.
export type ExpressShippingOptionData = {
  id: string;
  name: string;
  description?: string;
  isSelected?: boolean;
  amount: CTAmount;
};

export type ExpressOptions = {
  /**
   * A list of ISO 3166 country codes for limiting payments to cards from specific countries.
   */
  allowedCountries?: string[];
  /**
   * A callback function Checkout calls after pay button click. The response of this callback function will include a sessionId to initialize the payment attempt.
   */
  onPayButtonClick: () => Promise<OnclickResponse>;
  /**
   * A callback function that receives an address event when the buyer selects a shipping address in the express checkout pop up.
   @param address The address event received.
   */
  onShippingAddressSelected: (opts: { address: ExpressAddressData }) => Promise<void>;
  /**
   * A callback function that retrieves the list of available shipping methods.
   @param address The address to fetch available shipping methods.
   */
  getShippingMethods: (opts: { address: ExpressAddressData }) => Promise<ExpressShippingOptionData[]>;
  /**
   * A callback function that receives a shipping method event when the buyer selects a shipping method in the express checkout pop up.
   @param shippingMethod The shippingMethod event received.
   */
  onShippingMethodSelected: (opts: { shippingMethod: { id: string } }) => Promise<void>;

  /**
   * A Callback called when a payment is authorized.
   @param opts - Authorization event from psp, along with formatted shippingAddress and billingAddress
   */
  onPaymentSubmit: (opts: { shippingAddress: ExpressAddressData; billingAddress: ExpressAddressData }) => Promise<void>;
  onComplete?: OnComplete;

  initialAmount: CTAmount;
};

export interface PaymentExpressBuilder {
  build(config: ExpressOptions): ExpressComponent;
}
