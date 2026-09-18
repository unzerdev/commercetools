/**
 * The WALLET surfaces: Apple Pay and Google Pay.
 *
 * Each is the base method plus ONE call - the vendor's own sheet setter - and the object it takes is assembled
 * by the PROCESSOR and carried on the method as `wallet.payload`. The browser maps no DATA: the merchant's
 * identity with Apple/Google, the allowed networks and the button options are per-method configuration, the
 * total and the country come off the cart, and Google's gateway merchant id is the Unzer channel. So each
 * class here decides one thing only - WHICH setter its sheet goes to.
 *
 * The payload carries NO `onPaymentAuthorizedCallback`, and that omission is what makes the wallet payable.
 * Both vendor elements branch on it inside their own `onPaymentAuthorized`: given one, the element resolves
 * the sheet from that callback's `approve`/`reject` and does nothing else; given none, it calls the checkout's
 * own `onClick` itself, which is the ONLY call that tokenizes and therefore the only route to
 * `onPaymentSubmit`. Measured against the shipped SDK - the second branch reads `submitResponse` off that
 * call, and `getUnzerCheckout()` is internal to the SDK, so no integrator can drive it from the first.
 *
 * Neither renders a pay button: the platform sheet opens from Apple's or Google's own button, which the vendor
 * element draws. The base honours that through the method's `rendersOwnPayButton`, exactly as the reference
 * integration's wallet renderers set `buttonNeeded: false`.
 */
import { UnzerBaseMethodComponent } from '../base-method';
import type { UnzerPaymentElement } from '../elements';

export class UnzerApplePayMethodComponent extends UnzerBaseMethodComponent {
  protected override configureSurface(paymentEl: UnzerPaymentElement): void {
    const payload = this.method.wallet?.payload;
    if (!payload) {
      return;
    }
    this.pushToElement(paymentEl.setApplePayData, paymentEl, payload);
  }
}

export class UnzerGooglePayMethodComponent extends UnzerBaseMethodComponent {
  protected override configureSurface(paymentEl: UnzerPaymentElement): void {
    const payload = this.method.wallet?.payload;
    if (!payload) {
      return;
    }
    this.pushToElement(paymentEl.setGooglePayData, paymentEl, payload);
  }
}
