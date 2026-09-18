/**
 * The Unzer method surfaces, as ONE entry point: the element table, the builder Checkout calls, and the
 * factory that decides which surface a method gets.
 *
 * The implementation is split along the one axis the vendor's own surfaces differ on - a shared base plus a
 * thin per-method specialization, where the specialization exists only to hand the element something extra
 * before it can be paid with:
 *
 * - `base-method.ts`   the whole shared surface: mount, customer prefill, both submission paths, the charge.
 * - `methods/wallet.ts`     Apple Pay / Google Pay - each hands the vendor its own payment-sheet data.
 * - `methods/installment.ts` the instalment surface - hands the vendor the purchase's figures for its plans.
 * - `elements.ts`      the vendor element shapes and the code → tag table.
 * - `customer-data.ts` the customer mappings, both directions, as pure functions.
 *
 * WHICH class a method gets is decided by the CONFIG, never by a code list held here: the processor already
 * says what a surface needs (`wallet.kind`, `needsAmountData`), which is what keeps a vendor method list out of
 * the browser. A method that needs nothing extra is the base class itself.
 */
import type {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
} from '../../payment-enabler/payment-enabler';
import type { BaseOptions } from '../../payment-enabler/payment-enabler-psp';
import type { PaymentMethodView } from '../../payment-enabler/payment-config';
import { UnzerBaseMethodComponent } from './base-method';
import { UnzerApplePayMethodComponent, UnzerGooglePayMethodComponent } from './methods/wallet';
import { UnzerInstalmentMethodComponent } from './methods/installment';

export { UNZER_METHOD_ELEMENTS } from './elements';
export { toCompactBirthDate } from './customer-data';
export { UnzerBaseMethodComponent } from './base-method';
export { UnzerApplePayMethodComponent, UnzerGooglePayMethodComponent } from './methods/wallet';
export { UnzerInstalmentMethodComponent } from './methods/installment';

/**
 * The surface type a mounted method is, whichever class it turned out to be. Callers hold the base type
 * because every specialization differs only in what it hands the vendor at mount time.
 */
export type UnzerMethodComponent = UnzerBaseMethodComponent;

/**
 * The class for one method, chosen from what the processor said the surface needs.
 *
 * A wallet first (its sheet data decides which setter), then the instalment surface (the purchase's figures),
 * then the base. The order matters only in that no method is ever both - a wallet needs no plan list, and the
 * instalment surface has no sheet.
 */
const componentClassFor = (method: PaymentMethodView): typeof UnzerBaseMethodComponent => {
  if (method.wallet?.kind === 'applepay') {
    return UnzerApplePayMethodComponent;
  }
  if (method.wallet?.kind === 'googlepay') {
    return UnzerGooglePayMethodComponent;
  }
  if (method.needsAmountData) {
    return UnzerInstalmentMethodComponent;
  }
  return UnzerBaseMethodComponent;
};

export class UnzerMethodBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions,
    private method: PaymentMethodView,
  ) {}

  build(config: ComponentOptions): PaymentComponent {
    const Component = componentClassFor(this.method);
    return new Component(this.baseOptions, config, this.method);
  }
}
