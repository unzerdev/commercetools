/**
 * The INSTALMENT surface: the base method plus the purchase's figures.
 *
 * It is the one surface that asks the vendor a question before it can be paid with. On mount it fetches a PLAN
 * LIST - rates, terms, the total with interest - and that fetch is refused without the amount, the currency and
 * the country, because a lender prices a plan per market. Every other surface is paid from what the element
 * already holds, which is why the figures go here and not into the base.
 *
 * The push is made once the element is in the document, and only for this method: every other surface would
 * ignore the figures, and the vendor's setter is optional on the element.
 */
import { UnzerBaseMethodComponent } from '../base-method';
import type { UnzerPaymentElement } from '../elements';

/**
 * A minor-unit amount in the MAJOR units the vendor's `setBasketData` takes - the purchase total, as the
 * plan list is priced against it.
 *
 * `toFixed` before `Number` so the division's float tail never travels: a JPY cart (`fractionDigits: 0`) stays
 * an integer, a BHD one keeps its three decimals, and `1999 / 100` is `19.99` rather than `19.989999999999998`.
 */
export function toMajorUnits(minorUnits: number, fractionDigits: number): number {
  return Number((minorUnits / 10 ** fractionDigits).toFixed(fractionDigits));
}

export class UnzerInstalmentMethodComponent extends UnzerBaseMethodComponent {
  /**
   * The amount is the cart total WITHOUT the method surcharge: the server computes what is charged, and
   * the config carries the bare cart figure on purpose. A config with no currency or no amount pushes nothing -
   * the surface then asks for what it can, and the shopper sees the vendor's own message rather than a plan
   * list priced against a zero.
   */
  protected override configureSurface(paymentEl: UnzerPaymentElement): void {
    if (!this.config.currency || this.config.amount <= 0) {
      return;
    }
    this.pushToElement(paymentEl.setBasketData, paymentEl, {
      amount: toMajorUnits(this.config.amount, this.config.fractionDigits),
      currencyType: this.config.currency,
      // The COUNTRY belongs to the question, not to the display: the plan fetch is refused without one.
      // Omitted when the cart names none rather than invented.
      ...(this.config.country ? { country: this.config.country } : {}),
    });
  }
}
