/**
 * The BASE Unzer method surface - everything every method does the same way, and the one hook the methods
 * that need more hang off.
 *
 * Mounting the elements, prefilling the customer, both submission paths, the charge and the error surface are
 * shared here, while a method that has to hand the vendor something extra before it can be paid with says so
 * in ONE overridden method. Today that is the wallets (their own sheet data) and the instalment surface (the
 * purchase's figures for its plan list) - `methods/*.ts`.
 *
 * THE MOUNT, in order: `<unzer-payment publicKey locale>` wrapping the method's own element (plus
 * `<unzer-customer-form>` for a method that shows one), the customer prefill, then {@link configureSurface},
 * then a sibling `<unzer-checkout>` carrying a HIDDEN submit control unless the vendor draws its own button.
 *
 * THE HOST OWNS THE PAY BUTTON. This surface renders none the shopper can see: commercetools Checkout draws
 * its "Complete purchase", a storefront draws its own, and each of them calls {@link submit}. The vendor
 * documents exactly one way to tokenize - a button inside `<unzer-checkout>` clicked, the outcome reported
 * through `onPaymentSubmit` - so `submit()` clicks the hidden control and waits for that report. VALIDITY is
 * asked of the vendor the same way: `isValid()` makes it submit, keeps the tokenization when it passes and
 * answers `false` when it refuses, which is the only way to know - the fields are in the vendor's iframes and
 * `stateChanged` reports `enableCheckout: true` over an untouched form. The held tokenization is
 * what the following `submit()` posts, and {@link showValidation} is where a shopper with an unfinished form
 * is sent.
 *
 * EXCEPT OVER A WALLET, which the host's button cannot pay at all: Apple's and Google's sheets open only from
 * the button the vendor draws, so `isValid()` answers `false` for one and {@link showValidation} is where the
 * shopper is told which button pays and the vendor's button takes focus. A host that submits anyway is told
 * the same thing through `useVendorButton`. The host's hook is asked on the CLICK that would open the sheet
 * ({@link askHostBeforeSheet}, a capture-phase listener on the wallet element) and that click is HELD until
 * the answer comes, so a host that refuses - commercetools Checkout over unaccepted terms - stops the sheet
 * from opening at all rather than reporting after the shopper has already paid in it.
 *
 * Either way the vendor validates and tokenizes inside its own iframes and answers with a single-use resource
 * id, which the component posts to `POST /payments` with the device-fingerprint id the same answer carries -
 * plus, at most, the id of the CUSTOMER the vendor's own element created for this purchase.
 * Never card data, never a vault token, never basket data, cart lines or an amount: assembling and creating the
 * basket is the processor's work for every charge, and so is resolving the payer for one that reports
 * no customer. A `redirect` follow-up navigates the shopper to Unzer (3DS/redirect); a `none` follow-up
 * completes synchronously. Every failure routes through `onError` with a shopper-safe string from the locale
 * dictionary, resolved to the config's (the cart's) display language; mount and submit never throw.
 *
 * `onPayButtonClick` is the host's say before a charge the VENDOR started - a wallet sheet the shopper paid
 * from. It is asked on that path only: a host that calls `submit()` has already decided to pay, and
 * commercetools Checkout's own hook starts Checkout's transaction, which a `submit()` Checkout itself issued
 * is already inside of. On the wallet path it is asked at the CLICK, which the sheet waits for, and the same
 * answer is awaited again when the vendor reports, so a refusal stops both the sheet and the post.
 */
import type { ComponentOptions } from '../../payment-enabler/payment-enabler';
import type { BaseOptions } from '../../payment-enabler/payment-enabler-psp';
import type { PaymentMethodView, ShopperPrefill } from '../../payment-enabler/payment-config';
import { BaseComponent } from '../base';
import type { PaymentRequest } from '../../dtos/payment.dto';
import { escapeHtml } from '../../html';
import { formatMinorUnits } from '../../money';
import { postPaymentAndFollowUp } from '../post-payment';
import { toCollectedCustomer, toVendorCustomer, toVendorCustomerId } from './customer-data';
import { UNZER_METHOD_ELEMENTS } from './elements';
import type { UnzerCheckoutElement, UnzerPaymentElement, UnzerPaymentState, UnzerSubmitResult } from './elements';
import { whenUnzerElementDefined } from './sdk';

/** How long a host-driven submission waits for the vendor's report before it is given up as failed. */
const TOKENIZATION_TIMEOUT_MS = 30_000;

/**
 * How long the wallet click waits for the HOST's answer before the sheet is given up on.
 *
 * Bounded by the browser rather than by taste: Apple and Google open a sheet only under user activation, and
 * Blink discards that activation about five seconds after the press, so a replay later than this deadline
 * would be refused by the browser anyway. Four seconds leaves the replay inside that window and still answers
 * the older need the deadline was written for - a host whose hook never settles must not leave the post
 * waiting on a promise nobody resolves, which is a loader that never ends.
 */
const HOST_ANSWER_TIMEOUT_MS = 4_000;

/** How long a validation submission waits for the vendor's verdict before the form counts as not ready. */
const VENDOR_VALIDATION_TIMEOUT_MS = 10_000;

/** The single-use resource id of a SUCCESSFUL tokenization; `undefined` for a report the vendor refused. */
const resourceIdOf = (result: UnzerSubmitResult | undefined): string | undefined => {
  const tokenization = result?.submitResponse;
  const succeeded = tokenization?.success === true || tokenization?.status === 'SUCCESS';
  return succeeded ? tokenization?.data?.id : undefined;
};

type Deferred = { promise: Promise<void>; resolve: () => void };

/**
 * What the host's answer turned out to be within `ms`: it allowed the payment, it refused, or it never came.
 *
 * The three are separated because they are told to the shopper differently - a refusal is the host's own
 * message to raise, a silence is nobody's - and the timer is cleared on every path, so an answer that arrives
 * first leaves nothing pending behind it.
 */
const answeredWithin = async (answer: Promise<boolean>, ms: number): Promise<'allowed' | 'refused' | 'timeout'> => {
  let expire: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((settle) => {
    expire = setTimeout(() => settle('timeout'), ms);
  });
  const decided: Promise<'allowed' | 'refused'> = answer.then((allowed) => (allowed ? 'allowed' : 'refused'));
  try {
    return await Promise.race([decided, expired]);
  } finally {
    clearTimeout(expire);
  }
};

const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};
import styles from '../../style/style.module.scss';

export class UnzerBaseMethodComponent extends BaseComponent {
  /** The method this surface was built for - read by every subclass to find its own configuration. */
  protected method: PaymentMethodView;
  private paymentEl?: UnzerPaymentElement;
  /** The hidden control inside `<unzer-checkout>` that {@link submit} clicks; absent on a wallet. */
  private submitEl?: HTMLButtonElement;
  /** The host-driven submission waiting for the vendor's report; unset while the vendor submits on its own. */
  private hostSubmission?: Deferred;
  /** True once a `POST /payments` produced a payment: the tokenization must not be re-posted. */
  private spent = false;
  /** True while a `POST /payments` is in flight: guards a double submit. */
  private submitting = false;
  /** The WALLET element the vendor draws its own button inside; absent on every other method. */
  private walletEl?: HTMLElement;
  /** The host's answer to the click that opened the sheet, awaited when the vendor reports the tokenization. */
  private walletHookAnswer?: Promise<boolean>;
  /** The one replayed click the host approved, recognised by identity so no other click passes the gate. */
  private approvedWalletClick?: Event;
  /** True while the host is being asked about a wallet click: a second tap must not start a second transaction. */
  private askingWalletHost = false;
  /** The vendor's own verdict on the form (`stateChanged`); `undefined` until it has given one. */
  private vendorEnablesCheckout?: boolean;
  /** The tokenization a passed validation already produced, waiting for the `submit()` that follows it. */
  private heldTokenization?: UnzerSubmitResult;
  /** The validation submission in flight: the vendor's report settles it and is never posted. */
  private validationSubmission?: { settle: (result?: UnzerSubmitResult) => void };
  /** The validation in flight, so repeated `isValid()` calls ask the vendor once. */
  private validating?: Promise<boolean>;

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions, method: PaymentMethodView) {
    super(baseOptions, componentOptions);
    this.method = method;
  }

  async mount(selector: string): Promise<void> {
    try {
      const container = document.querySelector(selector);
      if (!container) {
        this.onError(`Payment component mount target not found: ${selector}`);
        return;
      }

      const tag = UNZER_METHOD_ELEMENTS[this.method.code];
      if (!tag) {
        this.onError(this.texts.formLoadFailed);
        return;
      }

      container.innerHTML = '';
      const heading = this.headingTemplate();
      if (heading !== '') {
        container.insertAdjacentHTML('afterbegin', heading);
      }

      const paymentEl = document.createElement('unzer-payment') as UnzerPaymentElement;
      paymentEl.addEventListener('stateChanged', (event) => this.readVendorState(event));

      paymentEl.setAttribute('publicKey', this.config.publicKey);
      paymentEl.setAttribute('locale', this.config.locale);

      if (this.method.clickToPayEnabled === false) {
        paymentEl.setAttribute('disableCTP', '');
      }
      const methodEl = document.createElement(tag);
      if (this.method.rendersOwnPayButton) {
        this.walletEl = methodEl;
        methodEl.addEventListener('click', this.askHostBeforeSheet, { capture: true });
      }
      paymentEl.appendChild(methodEl);

      if (this.method.requiresCustomerData) {
        paymentEl.appendChild(document.createElement('unzer-customer-form'));
      }
      this.paymentEl = paymentEl;
      container.appendChild(paymentEl);
      this.prefillCustomerForm(paymentEl);
      // Whatever THIS method needs beyond the shared mount. The base needs nothing, so the hook does nothing.
      this.configureSurface(paymentEl);

      const checkoutEl = document.createElement('unzer-checkout') as UnzerCheckoutElement;
      checkoutEl.onPaymentSubmit = (result) => void this.handleSubmission(result);

      // The vendor submits on a click of a button that is this element's child, and toggles that button's
      // `disabled` with the form's validity. The control is HIDDEN: the host draws the button the shopper
      // sees and reaches this one through submit(). A WALLET gets none - its sheet opens only from the
      // vendor's own button, which the wallet element draws itself.
      if (!this.method.rendersOwnPayButton) {
        checkoutEl.insertAdjacentHTML(
          'beforeend',
          '<button type="submit" data-unzer-submit hidden tabindex="-1" aria-hidden="true"></button>',
        );
        this.submitEl = checkoutEl.querySelector<HTMLButtonElement>('[data-unzer-submit]') ?? undefined;
      }

      container.appendChild(checkoutEl);

      // Both upgrades: until `<unzer-checkout>` is defined a click on its child submits nothing, and a host
      // calling submit() right after mount would only wait out the watchdog.
      await Promise.all([whenUnzerElementDefined(tag), whenUnzerElementDefined('unzer-checkout')]);
    } catch {
      this.onError(this.texts.formLoadFailed);
    }
  }

  /**
   * The per-method hook, called ONCE per mount with the element already in the document and the customer
   * already prefilled, and BEFORE `<unzer-checkout>` exists.
   *
   * A subclass hands the vendor whatever its own surface cannot be paid with without - and does so
   * NON-FATALLY, because a setter is optional on the element, the vendor may reject the call and it may answer
   * a promise that never settles; none of those is a reason to refuse a payment the form can still take. Use
   * {@link pushToElement} rather than calling the setter directly, so that rule lives in one place.
   */
  protected configureSurface(paymentEl: UnzerPaymentElement): void {
    void paymentEl;
  }

  /**
   * Call one optional vendor setter and never let it break the mount: a missing setter is skipped, a throw is
   * swallowed, and a returned promise is deliberately NOT awaited - a hanging vendor promise must not hold the
   * mount open.
   */
  protected pushToElement(
    setter: ((data: never) => void | Promise<unknown>) | undefined,
    paymentEl: UnzerPaymentElement,
    data: unknown,
  ): void {
    if (!setter) {
      return;
    }
    try {
      void Promise.resolve((setter as (payload: unknown) => void | Promise<unknown>).call(paymentEl, data)).catch(
        () => {},
      );
    } catch {
      /* the element mounts and the shopper can still pay, or pick another method */
    }
  }

  /**
   * The HOST-DRIVEN path: the host owns the pay button and asks this surface to submit. The hidden control
   * inside `<unzer-checkout>` is clicked, so the vendor tokenizes exactly as it would on its own button, and
   * the call resolves once {@link handleSubmission} has handled the report - or once the watchdog gave up on
   * a report that never came, so a host waiting on this promise is never left hanging.
   */
  async submit(): Promise<void> {
    if (this.spent || this.submitting) {
      return;
    }
    if (this.method.rendersOwnPayButton) {
      await this.showValidation();
      this.onError(this.texts.useVendorButton);
      return;
    }
    const control = this.submitEl;
    if (!control?.isConnected) {
      this.onError(this.texts.paymentInitFailed);
      return;
    }
    const held = this.heldTokenization;
    if (held) {
      this.heldTokenization = undefined;
      this.submitting = true;
      try {
        await this.postTokenization(held);
      } finally {
        this.submitting = false;
      }
      return;
    }
    if (!this.formIsReady()) {
      await this.showValidation();
      this.onError(this.texts.paymentDetailsIncomplete);
      return;
    }

    this.submitting = true;
    const outcome = deferred();
    this.hostSubmission = outcome;
    const watchdog = setTimeout(() => {
      if (this.hostSubmission !== outcome) {
        return;
      }
      this.hostSubmission = undefined;
      this.onError(this.texts.paymentInitFailed);
      outcome.resolve();
    }, TOKENIZATION_TIMEOUT_MS);
    try {
      control.click();
      await outcome.promise;
    } catch {
      this.onError(this.texts.paymentInitFailed);
    } finally {
      clearTimeout(watchdog);
      this.hostSubmission = undefined;
      this.submitting = false;
    }
  }

  /**
   * The vendor's report, on either path. A pending host submission is settled here without asking the host's
   * hook: the host already decided to pay when it called {@link submit}. A report with no host submission
   * behind it is the VENDOR's own (a wallet sheet), the one case the hook was designed for, so it is asked
   * before anything is posted; the in-flight guard is taken here rather than at the click, so a submission
   * the vendor refuses on validation leaves the surface usable for another attempt.
   */
  private async handleSubmission(result: UnzerSubmitResult): Promise<void> {
    const validation = this.validationSubmission;
    if (validation) {
      this.validationSubmission = undefined;
      validation.settle(result);
      return;
    }
    const pending = this.hostSubmission;
    if (pending) {
      this.hostSubmission = undefined;
      try {
        await this.postTokenization(result);
      } finally {
        pending.resolve();
      }
      return;
    }
    if (this.spent || this.submitting) {
      return;
    }
    this.submitting = true;
    const asked = this.walletHookAnswer;
    this.walletHookAnswer = undefined;
    try {
      if (!(await (asked ?? this.hostAllowsPayment()))) {
        return;
      }
      await this.postTokenization(result);
    } finally {
      this.submitting = false;
    }
  }

  /**
   * The host's say, asked on the CLICK that would open the wallet sheet - and the sheet is HELD until it
   * answers yes.
   *
   * The listener runs in the CAPTURE phase on the wallet element, which is an ancestor of the button the
   * vendor draws - both wallet elements render into the light DOM (`createRenderRoot()` returns the element
   * itself, measured), so there is no shadow boundary here and capture simply reaches the ancestor before the
   * target. Every click is cancelled first (`preventDefault` and `stopImmediatePropagation`), which is what
   * keeps the sheet shut while the host validates: a host that refuses - commercetools Checkout over
   * unaccepted terms - must not leave the shopper in a sheet that cannot pay. A refusal is left silent on
   * purpose, because the host raises its own message on its own surface and a second one from here would only
   * contradict it; nothing is remembered, so the next click asks again.
   *
   * On a yes the click is REPLAYED on the control the shopper pressed, as an event this listener then
   * recognises BY IDENTITY - a flag would still be set if the replay never arrived, and the next genuine click
   * would walk through the gate unasked. This is the one part that rests on the browser rather than on us:
   * Apple and Google open a sheet only under user activation, cancelling a click does not consume the
   * activation the real press granted, and {@link HOST_ANSWER_TIMEOUT_MS} is kept under that window so the
   * replay lands inside it. Measured on Blink only: whether WebKit accepts a replayed click for Apple Pay is
   * unverified, and stands as an open risk rather than a claim. A host slower than that is the one refusal the shopper is told about, since
   * nothing else on screen would explain a button that did nothing.
   *
   * ONE ASK PER PAYMENT, because each ask starts a Checkout transaction. While the host is being asked a
   * second tap is swallowed; once it has said yes the answer is HELD, so a shopper who dismisses the sheet and
   * presses again reopens it on that same approval rather than opening a second transaction. Holding the guard
   * itself across the sheet would have closed the same hole by making a dismissed sheet leave the button dead
   * for the life of the page, which is the commoner event of the two. A surface that has paid or is paying
   * swallows the click outright - one tokenization is one payment, and a second sheet could only spend it
   * twice.
   */
  private readonly askHostBeforeSheet = (event: Event): void => {
    if (event === this.approvedWalletClick) {
      this.approvedWalletClick = undefined;
      return;
    }
    const pressed = event.target;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (this.spent || this.submitting || this.askingWalletHost || !(pressed instanceof Element)) {
      return;
    }
    if (this.walletHookAnswer) {
      this.replayWalletClick(pressed);
      return;
    }

    this.askingWalletHost = true;
    const answer = this.hostAllowsPayment();
    this.walletHookAnswer = answer;
    void answeredWithin(answer, HOST_ANSWER_TIMEOUT_MS)
      .then((outcome) => {
        this.askingWalletHost = false;
        if (outcome === 'allowed') {
          this.replayWalletClick(pressed);
          return;
        }
        this.walletHookAnswer = undefined;
        if (outcome === 'timeout') {
          this.onError(this.texts.paymentInitFailed);
        }
      })
      .catch(() => {
        this.askingWalletHost = false;
        this.walletHookAnswer = undefined;
      });
  };

  /**
   * Send the click the host approved, as the one event {@link askHostBeforeSheet} recognises by identity.
   *
   * Identity rather than a flag, because a flag raised before a dispatch that never lands stays raised, and
   * the next genuine click would then reach the vendor with nobody asked.
   */
  private replayWalletClick(pressed: Element): void {
    this.approvedWalletClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    pressed.dispatchEvent(this.approvedWalletClick);
  }

  /** Keep the vendor's own verdict on the form; anything but a boolean is no verdict and changes nothing. */
  private readVendorState(event: Event): void {
    const state = (event as CustomEvent<UnzerPaymentState>).detail;
    if (typeof state?.enableCheckout === 'boolean') {
      this.vendorEnablesCheckout = state.enableCheckout;
    }
    this.heldTokenization = undefined;
  }

  /**
   * Ask the VENDOR whether it will take this form, by making it submit.
   *
   * It is the only way to find out: the fields live in the vendor's iframes, and the element validates them
   * nowhere but inside its own submission - `stateChanged` reports `enableCheckout: true` over an untouched
   * form, measured. A refusal costs nothing, because the vendor fails before it tokenizes; a pass produces the
   * single-use tokenization, which is kept for the `submit()` the host issues moments later rather than asked
   * for a second time. The report is intercepted by {@link handleSubmission} and never posted from here.
   */
  private async validateWithVendor(): Promise<boolean> {
    if (this.heldTokenization) {
      return true;
    }
    if (this.validating) {
      return this.validating;
    }
    const control = this.submitEl;
    if (!control?.isConnected || control.disabled) {
      return false;
    }
    if (!this.hasFieldsToValidate()) {
      return true;
    }
    const run = (async (): Promise<boolean> => {
      let settle: (result?: UnzerSubmitResult) => void = () => {};
      const reported = new Promise<UnzerSubmitResult | undefined>((resolve) => {
        settle = resolve;
      });
      this.validationSubmission = { settle };
      const watchdog = setTimeout(() => {
        if (this.validationSubmission) {
          this.validationSubmission = undefined;
          settle(undefined);
        }
      }, VENDOR_VALIDATION_TIMEOUT_MS);
      try {
        control.click();
        const result = await reported;
        if (!resourceIdOf(result)) {
          return false;
        }
        this.heldTokenization = result;
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(watchdog);
        this.validationSubmission = undefined;
        this.validating = undefined;
      }
    })();
    this.validating = run;
    return run;
  }

  /**
   * Whether this surface has anything to validate: a field the vendor drew for the shopper to fill.
   *
   * A REDIRECT method draws none - the shopper types nothing here and pays at the bank - so making the vendor
   * submit would validate nothing and start the payment at the moment the host is only asking whether it may.
   * Such a method is answered on the control, exactly as before this check existed.
   */
  private hasFieldsToValidate(): boolean {
    return this.vendorControls(this.paymentEl).some((el) => el.matches('input, select, textarea, iframe'));
  }

  /**
   * Whether the vendor will take this form.
   *
   * Its own `stateChanged` verdict decides once it has given one - that is the only thing that knows whether
   * the shopper filled the fields, which live in the vendor's iframes where nothing here can look. Until then
   * the submit control decides as it always did, so a method the vendor never reports state for is never made
   * unpayable; the vendor manages that control's `disabled` only when the element is given one to manage.
   */
  private formIsReady(): boolean {
    if (this.vendorEnablesCheckout !== undefined) {
      return this.vendorEnablesCheckout;
    }
    return Boolean(this.submitEl?.isConnected) && !this.submitEl?.disabled;
  }

  /**
   * Every control the vendor drew under an element, its shadow roots included and the surface's own hidden
   * submit control excluded.
   */
  private vendorControls(root: HTMLElement | undefined): HTMLElement[] {
    if (!root) {
      return [];
    }
    const found: HTMLElement[] = [];
    const queue: ParentNode[] = [root];
    while (queue.length > 0) {
      const node = queue.shift() as ParentNode;
      for (const child of Array.from(node.querySelectorAll('*'))) {
        const el = child as HTMLElement;
        if (
          !el.hasAttribute('data-unzer-submit') &&
          el.matches('button, [role="button"], iframe, input, select, textarea')
        ) {
          found.push(el);
        }
        if (el.shadowRoot) {
          queue.push(el.shadowRoot);
        }
      }
    }
    return found;
  }

  /**
   * Make the vendor mark what is wrong.
   *
   * Its elements redden a field only once that field has been TOUCHED - focused and left again - which a
   * submission the shopper never made does not do, so a refused validation leaves every field looking fine.
   * Touching each one in place runs exactly the per-field check the shopper's own pass through the form would
   * have run. Scrolling is suppressed throughout, so the page does not chase the focus down the form.
   */
  private touchVendorFields(fields: HTMLElement[]): void {
    for (const field of fields) {
      field.focus({ preventScroll: true });
      field.blur();
    }
  }

  /**
   * Say which button pays, take the shopper back to it and make it obvious.
   *
   * The host's own button cannot pay a wallet, so a host that offers it anyway - or asks this surface to
   * validate - leaves the shopper looking at a control that does nothing, possibly scrolled off the screen
   * entirely. The line is rendered once directly beneath the vendor's button and carries an arrow pointing
   * back up at it; the vendor's own button is left exactly as Apple and Google draw it, with nothing outlined
   * or overlaid. The surface is then scrolled into the middle of the viewport and the button takes focus, so
   * the next keystroke or tap lands on the one control that opens the sheet.
   */
  async showValidation(): Promise<void> {
    const walletEl = this.walletEl;
    const target = walletEl ?? this.paymentEl;
    if (!target) {
      return;
    }
    if (walletEl && !walletEl.parentElement?.querySelector('[data-unzer-wallet-hint]')) {
      walletEl.insertAdjacentHTML(
        'afterend',
        `<p class="${styles.walletHint}" data-unzer-wallet-hint role="status">` +
          `<span class="${styles.walletPointer}" data-unzer-wallet-pointer aria-hidden="true">` +
          '<svg viewBox="0 0 24 24" width="18" height="18" focusable="false">' +
          '<path d="M12 20V6m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"></path>' +
          '</svg></span>' +
          `${escapeHtml(this.texts.useVendorButton)}</p>`,
      );
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const controls = this.vendorControls(target);
    if (!walletEl) {
      this.touchVendorFields(controls);
    }
    controls[0]?.focus({ preventScroll: true });
  }

  /** The host's pay hook, when it set one: awaited before anything is posted, a rejection meaning "do not proceed". */
  private async hostAllowsPayment(): Promise<boolean> {
    const hook = this.componentOptions?.onPayButtonClick;
    if (!hook) {
      return true;
    }
    try {
      await hook();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether a host may submit now: NEVER for a wallet, because only the vendor's own button opens its sheet
   * and a host that starts a transaction over one cannot finish it; else whether the vendor has enabled its
   * control. A host that honours the answer calls {@link showValidation} instead, which is where the shopper
   * learns which button pays.
   */
  async isValid(): Promise<boolean> {
    if (this.method.rendersOwnPayButton || this.spent || this.submitting) {
      return false;
    }
    if (!this.formIsReady()) {
      return false;
    }
    return this.validateWithVendor();
  }

  /**
   * Turn a submission result into a payment: read the single-use resource id and post it to the
   * processor. Called from both submission paths, each of which already holds the in-flight guard.
   */
  private async postTokenization(result: UnzerSubmitResult): Promise<void> {
    const resourceId = resourceIdOf(result);
    if (!resourceId) {
      this.onError(this.texts.paymentInitFailed);
      return;
    }

    try {
      const locale = this.locale ?? this.config.locale;
      const vendorCustomerId = toVendorCustomerId(result, this.paymentEl);
      // The form's values are sent ONLY when the element reported no customer of its own. With an id the
      // processor charges THAT resource and maps nothing, so the shopper data would be read by
      // nobody - and shopper data no one reads has no business leaving the browser. Without an id the payer is
      // mapped from the cart, and these values are what fills a guest cart's gaps and carries the birthdate the
      // cart has no field for at all.
      const collectedCustomer = vendorCustomerId ? undefined : toCollectedCustomer(this.paymentEl?.getCustomerData?.());
      const body: PaymentRequest = {
        paymentMethodCode: this.method.code,
        resourceId,
        returnUrl: window.location.href,
        ...(result.threatMetrixId ? { deviceFingerprintId: result.threatMetrixId } : {}),
        ...(collectedCustomer ? { collectedCustomer } : {}),
        ...(vendorCustomerId ? { vendorCustomerId } : {}),
        ...(locale ? { locale } : {}),
      };
      this.spent = await postPaymentAndFollowUp(
        {
          processorUrl: this.processorUrl,
          sessionId: this.sessionId,
          texts: this.texts,
          onComplete: this.onComplete,
          onError: this.onError,
          onActionRequired: this.onActionRequired,
          onPaymentProcessing: this.onPaymentProcessing,
        },
        body,
      );
    } catch {
      this.onError(this.texts.paymentFailed);
    }
  }

  /**
   * Hand the element the whole CUSTOMER as API data (`toVendorCustomer`) - for EVERY method, not only
   * the ones that show the form. Whether the vendor renders a customer form and whether the CHARGE has a
   * described payer are two different questions: the element creates its customer resource either way, and a
   * card charge linked to a customer that names nobody is the same fraud- and invoice-check problem as a
   * paylater one. `<unzer-customer-form>` is still mounted only for a `requiresCustomerData` method.
   *
   * `setCustomerData` is optional on the element, so a surface whose SDK predates the customer API falls back
   * to `updateCustomerData` - which cannot carry the reference, and then a checkout behaves as it did before
   * this became possible.
   */
  private prefillCustomerForm(paymentEl: UnzerPaymentElement): void {
    const hostCustomer = this.componentOptions?.customer;
    const prefill: ShopperPrefill | undefined =
      this.config.shopper || hostCustomer ? { ...this.config.shopper, ...hostCustomer } : undefined;
    if (!prefill) {
      return;
    }

    const customer = toVendorCustomer(prefill, (this.locale ?? this.config.locale)?.split(/[-_]/)[0]);

    if (paymentEl.setCustomerData) {
      paymentEl.setCustomerData(customer);
      return;
    }
    paymentEl.updateCustomerData?.(customer);
  }

  /**
   * What sits above the vendor form — the SURCHARGE, and nothing else.
   *
   * The method's NAME is not repeated here: the host already names the method on the row the shopper
   * picked, and the surface is mounted under that row, so a second heading only restated what the shopper
   * had just clicked. The surcharge has no such twin — it is the one fact about the choice that the form
   * itself never shows — so it stays, and a method without one renders no heading at all rather than an
   * empty bar.
   */
  private headingTemplate(): string {
    if (this.method.surcharge <= 0) {
      return '';
    }
    const surcharge = escapeHtml(formatMinorUnits(this.config, this.method.surcharge));
    return (
      `<div class="${styles.wrapper}">` +
      `<span class="${styles.subHeading}" data-unzer-surcharge>+${surcharge}</span>` +
      `</div>`
    );
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
