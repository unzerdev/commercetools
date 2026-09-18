/**
 * THE METHOD LIST - the one integration a merchant adds in commercetools Checkout to offer every Unzer method
 * at once, advertised as the custom component type `unzer`. Checkout mounts one component per integration it
 * has; this one renders the whole list of methods the processor returned for the session cart's STORE
 * (`GET /operations/payment-config`: the methods the merchant enabled in the Merchant Center app for the cart's
 * store, else the default scope, else nothing, each already filtered for the cart) and mounts the chosen method's
 * own component under the row the shopper picked - a storefront's payment step, packaged as a single element.
 * Nothing here decides which methods exist, in which order or under which name: all of that arrives resolved.
 *
 * The same component is also reachable as the `embedded` drop-in for a storefront that prefers that contract;
 * Checkout is offered the component only.
 *
 * The HOST owns the pay button - commercetools Checkout's "Complete purchase", a storefront's own - and calls
 * `submit()`, which the list delegates to the chosen method (`componentHasSubmit` / `dropinHasSubmit` say the
 * call is available); with nothing chosen it reports `paymentInitFailed`, and on a method that draws its own
 * button (the wallets) the method itself answers `useVendorButton` and points the shopper at that button.
 * `isValid()` asks the chosen method whether the vendor form is ready, and a chosen wallet answers `false`:
 * only its own button pays, so a host that honours the answer never starts a transaction over one and calls
 * `showValidation()` instead, which outlines the chosen row and hands the rest to that row's method.
 * `showPayButton` from the host is accepted and ignored: nothing here draws a button.
 * `isAvailable()` is false when the store offers no method. `onDropinReady` fires once the LIST is rendered,
 * not once a method's form is up.
 *
 * Every value the list interpolates (name, description, surcharge, logo, code) is escaped exactly once, where
 * it becomes HTML (`src/html.ts`).
 */
import type {
  ComponentOptions,
  DropinComponent,
  DropinOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
} from '../../payment-enabler/payment-enabler';
import type { ShopperPrefill } from '../../payment-enabler/payment-config';
import type { BaseOptions } from '../../payment-enabler/payment-enabler-psp';
import type { PaymentMethodView } from '../../payment-enabler/payment-config';
import { escapeHtml } from '../../html';
import { formatMinorUnits } from '../../money';
import { UnzerMethodBuilder, type UnzerMethodComponent } from './unzer-method';
import styles from '../../style/method-list.module.scss';

/** The processor's logo for a row: absolute as-is, root-relative against the processor origin, none when it sent none. */
export const methodLogoUrl = (method: PaymentMethodView, processorUrl: string): string | undefined => {
  const logo = method.logo?.trim();
  if (!logo) {
    return undefined;
  }
  try {
    return new URL(logo, processorUrl).toString();
  } catch {
    return undefined;
  }
};

/** The component type this list is advertised under; the processor names the same literal in its catalogue. */
export const UNZER_COMPOSITE_TYPE = 'unzer';

/** What both contracts hand the list: the host's pay hook, the drop-in's ready hook, a host-collected customer. */
export type MethodListOptions = {
  onPayButtonClick?: () => Promise<void>;
  onDropinReady?: () => Promise<void>;
  customer?: Partial<ShopperPrefill>;
};

/** One host id per list instance, so two lists on one page never mount into each other's host. */
let hostCounter = 0;

/** The Checkout integration: the custom component type `unzer`. */
export class UnzerMethodListBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;

  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new UnzerMethodListComponent(this.baseOptions, {
      ...(config.onPayButtonClick ? { onPayButtonClick: config.onPayButtonClick } : {}),
      ...(config.customer ? { customer: config.customer } : {}),
    });
  }
}

/** The same list under the drop-in contract, for a storefront that mounts drop-ins. */
export class UnzerEmbeddedDropinBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true;

  constructor(private baseOptions: BaseOptions) {}

  build(config: DropinOptions): DropinComponent {
    return new UnzerMethodListComponent(this.baseOptions, {
      ...(config.onPayButtonClick ? { onPayButtonClick: config.onPayButtonClick } : {}),
      ...(config.onDropinReady ? { onDropinReady: config.onDropinReady } : {}),
    });
  }
}

export class UnzerMethodListComponent implements PaymentComponent, DropinComponent {
  private readonly hostId = `unzer-dropin-host-${++hostCounter}`;
  private list?: HTMLElement;
  /** The ONE mount host, moved under whichever row is chosen. */
  private host?: HTMLElement;
  private selected?: { code: string; component: UnzerMethodComponent };
  /** True while a `POST /payments` is in flight or the attempt is settled: the shopper may not switch methods. */
  private locked = false;

  constructor(
    private readonly baseOptions: BaseOptions,
    private readonly options: MethodListOptions,
  ) {}

  async mount(selector: string): Promise<void> {
    const container = document.querySelector(selector);
    if (!container) {
      this.baseOptions.onError(`Payment component mount target not found: ${selector}`);
      return;
    }
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = styles.dropin;
    root.setAttribute('data-unzer-dropin', '');

    const methods = this.baseOptions.config.paymentMethods;
    if (methods.length === 0) {
      root.insertAdjacentHTML(
        'afterbegin',
        `<p class="${styles.empty}" data-unzer-no-methods>${escapeHtml(this.baseOptions.texts.noPaymentMethods)}</p>`,
      );
      container.appendChild(root);
      await this.notifyReady();
      return;
    }

    const list = document.createElement('div');
    list.className = styles.list;
    list.setAttribute('role', 'radiogroup');
    list.insertAdjacentHTML('afterbegin', methods.map((method) => this.renderRow(method)).join(''));

    const host = document.createElement('div');
    host.className = styles.host;
    host.id = this.hostId;
    host.setAttribute('data-unzer-method-host', '');
    host.hidden = true;
    list.appendChild(host);

    list.addEventListener('click', (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>('[data-unzer-method-row]');
      if (!row || this.locked) {
        return;
      }
      void this.select(row.getAttribute('data-unzer-method-row') ?? '');
    });

    root.appendChild(list);
    container.appendChild(root);
    this.list = list;
    this.host = host;

    // A list of one with no form under it is a dead end inside the payment step; pick it for the shopper.
    if (methods.length === 1) {
      await this.select(methods[0].code);
    }
    await this.notifyReady();
  }

  /** The host's button asks the list; the chosen method answers, nothing chosen refuses. */
  async submit(): Promise<void> {
    if (!this.selected) {
      this.baseOptions.onError(this.baseOptions.texts.paymentInitFailed);
      return;
    }
    await this.selected.component.submit();
  }

  /** Whether the host may submit now: nothing chosen is not ready, else the chosen method answers. */
  isValid(): Promise<boolean> {
    return this.selected ? this.selected.component.isValid() : Promise.resolve(false);
  }

  /**
   * Show the shopper what stands between them and paying: the chosen row is marked `data-unzer-attention` for
   * the outline the stylesheet draws, every other row loses that mark, and the chosen method says the rest -
   * for a wallet, the line naming its own button, the scroll back to it and the focus on it.
   */
  async showValidation(): Promise<void> {
    const chosen = this.selected;
    for (const row of this.list?.querySelectorAll<HTMLElement>('[data-unzer-method-row]') ?? []) {
      if (chosen && row.getAttribute('data-unzer-method-row') === chosen.code) {
        row.setAttribute('data-unzer-attention', '');
      } else {
        row.removeAttribute('data-unzer-attention');
      }
    }
    await chosen?.component.showValidation();
  }

  /** A store with no method to offer has nothing to pay with; Checkout may hide the integration on this answer. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.baseOptions.config.paymentMethods.length > 0);
  }

  private renderRow(method: PaymentMethodView): string {
    const name = escapeHtml(method.name || method.code);
    const surcharge =
      method.surcharge > 0 ? ` (+${escapeHtml(formatMinorUnits(this.baseOptions.config, method.surcharge))})` : '';
    const logo = methodLogoUrl(method, this.baseOptions.processorUrl);
    const description = method.description
      ? `<span class="${styles.description}">${escapeHtml(method.description)}</span>`
      : '';
    return (
      `<button type="button" role="radio" aria-checked="false" class="${styles.row}" ` +
      `data-unzer-method-row="${escapeHtml(method.code)}">` +
      (logo ? `<img class="${styles.logo}" src="${escapeHtml(logo)}" alt="${name}">` : '') +
      `<span class="${styles.text}"><span class="${styles.name}">${name}${surcharge}</span>${description}</span>` +
      `<span class="${styles.check}" aria-hidden="true"></span>` +
      `</button>`
    );
  }

  /**
   * Mount the chosen method under its row. The previous surface is torn down first; the per-method mount
   * writes its DOM synchronously before its first await, so a later selection's clear always wins over an
   * earlier one still waiting on the SDK.
   */
  private async select(code: string): Promise<void> {
    if (this.locked || this.selected?.code === code || !this.list || !this.host) {
      return;
    }
    const method = this.baseOptions.config.paymentMethods.find((candidate) => candidate.code === code);
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('[data-unzer-method-row]'));
    const row = rows.find((candidate) => candidate.getAttribute('data-unzer-method-row') === code);
    if (!method || !row) {
      return;
    }

    this.teardownSelected();
    for (const other of rows) {
      other.removeAttribute('data-unzer-selected');
      other.removeAttribute('data-unzer-attention');
      other.setAttribute('aria-checked', 'false');
    }
    row.setAttribute('data-unzer-selected', '');
    row.setAttribute('aria-checked', 'true');
    row.insertAdjacentElement('afterend', this.host);
    this.host.hidden = false;

    const component = new UnzerMethodBuilder(this.wrappedBaseOptions(), method).build({
      ...(this.options.onPayButtonClick ? { onPayButtonClick: this.options.onPayButtonClick } : {}),
      ...(this.options.customer ? { customer: this.options.customer } : {}),
    }) as UnzerMethodComponent;
    this.selected = { code, component };
    await component.mount(`#${this.hostId}`);
  }

  private teardownSelected(): void {
    if (this.host) {
      this.host.innerHTML = '';
      this.host.hidden = true;
    }
    this.selected = undefined;
  }

  /** The chosen method's callbacks, with the lock ridden on them: locked from the charge on, released by a retryable failure. */
  private wrappedBaseOptions(): BaseOptions {
    const base = this.baseOptions;
    return {
      ...base,
      onPaymentProcessing: () => {
        this.setLocked(true);
        base.onPaymentProcessing?.();
      },
      onComplete: (result) => {
        this.setLocked(true);
        base.onComplete(result);
      },
      onError: (error, context) => {
        this.setLocked(Boolean(context?.paymentReference));
        // Forwarded with the arity it arrived with: a wrapper that always passes a second argument hands
        // every host an explicit `undefined` the component never sent.
        if (context === undefined) {
          base.onError(error);
          return;
        }
        base.onError(error, context);
      },
    };
  }

  private setLocked(locked: boolean): void {
    this.locked = locked;
    this.list?.setAttribute('aria-disabled', String(locked));
    for (const row of this.list?.querySelectorAll<HTMLButtonElement>('[data-unzer-method-row]') ?? []) {
      row.disabled = locked;
    }
  }

  private async notifyReady(): Promise<void> {
    try {
      await this.options.onDropinReady?.();
    } catch {
      // A host hook that fails must not take the rendered list down with it.
    }
  }
}
