import { PaymentRequest, PaymentResponse } from '../dtos/payment.dto';
import { ActionRequired, PaymentResult } from '../payment-enabler/payment-enabler';
import { ShopperTexts } from '../locale';

/**
 * What a surface hands the shared charge: its processor endpoint, the session credential the shopper
 * routes are authenticated by, the shopper strings already resolved to the cart's locale, and the host
 * callbacks. The callbacks are the host's own functions, held on the component since construction.
 */
export interface PostPaymentContext {
  processorUrl: string;
  sessionId: string;
  texts: ShopperTexts;
  onComplete: (result: PaymentResult) => void;
  onError: (error: any, context?: { paymentReference?: string }) => void;
  onActionRequired?: (action: ActionRequired) => void;
  onPaymentProcessing?: () => void;
}

/**
 * `POST /payments` plus the follow-up action the processor answers with — the one charge path behind
 * the per-method component's tokenized `resourceId`, so the spent decision and the error surface are
 * decided once.
 *
 * Resolves TRUE once the processor answered 2xx, on the status ALONE: a CT Payment exists, so the
 * tokenization is SPENT and must never be posted again — including a 2xx body that
 * carries no action this surface can read, and including a 2xx whose body cannot be parsed at all,
 * because re-posting any of them would charge the shopper twice. Resolves FALSE only when no payment can
 * have been created: the request never arrived, or the processor refused it.
 *
 * A `redirect` action navigates the shopper to the vendor (3-D Secure / redirect); `none` completes
 * synchronously. Every failure is reported through `onError` with a shopper-safe string from the locale
 * dictionary, and nothing here throws.
 */
/**
 * Tell the host the component is about to take the screen - here, to leave the page for the provider.
 *
 * A NOTIFICATION, never a gate, and fenced accordingly: the call is not awaited, a synchronous throw is
 * swallowed, and a returned promise is deliberately left unobserved (its rejection defused) so a host that
 * rejects or never settles cannot hold up a navigation the shopper's money already depends on. The payload
 * is the reference connectors' own vocabulary, so a host written against one of them or the template
 * understands it unchanged.
 */
function notifyActionRequired(ctx: PostPaymentContext): void {
  // EVERYTHING is inside the fence, the absent-hook check included: this function stands in front of a
  // navigation the shopper's money already depends on, so no line of it may throw into that path.
  try {
    const action: ActionRequired = { type: 'fullscreen' };
    void Promise.resolve(ctx.onActionRequired?.(action)).catch(() => {});
  } catch {
    /* a host callback must not stop the payment */
  }
}

export async function postPaymentAndFollowUp(ctx: PostPaymentContext, body: PaymentRequest): Promise<boolean> {
  // The attempt has left the vendor surface: whatever the host does for the wait (an overlay, a
  // disabled page) belongs from here on, not from the pay click. Never allowed to break the charge.
  try {
    ctx.onPaymentProcessing?.();
  } catch {
    /* a host callback must not stop the payment */
  }

  let response: Response;
  try {
    response = await fetch(ctx.processorUrl + '/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': ctx.sessionId,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // The request never arrived, so no charge was attempted.
    ctx.onError(ctx.texts.paymentFailed);
    return false;
  }

  if (!response.ok) {
    ctx.onError(ctx.texts.paymentFailed);
    return false;
  }

  // Past this point `createPayment` has charged the vendor and written the Transaction, so every path
  // returns true — a body this surface cannot read is no evidence that the money stayed put.
  try {
    const data = (await response.json()) as PaymentResponse;
    switch (data.action.kind) {
      case 'redirect': {
        // The one navigation this library performs by someone else's value: the processor relays the
        // vendor's own `redirectUrl`. A target that is not http(s) is refused rather than assigned -
        // `location.assign('javascript:…')` EXECUTES in the major browsers, in the merchant page's own
        // context, so the scheme is checked here even though the value comes from a trusted server. An
        // unparsable URL lands in the same branch, since `new URL` throws into the catch below.
        const target = new URL(data.action.payload.url, window.location.href);
        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
          // Reported, never re-posted: the charge already happened, which is what the `true` below says.
          ctx.onError(ctx.texts.paymentFailed, { paymentReference: data.paymentReference });
          break;
        }
        notifyActionRequired(ctx);
        window.location.assign(target.toString());
        break;
      }
      case 'none':
        ctx.onComplete({ isSuccess: true, paymentReference: data.paymentReference ?? '' });
        break;
      // A method that takes no money at checkout: the payment SUCCEEDED as far as the vendor is concerned, and
      // what comes back is what the shopper must be told - the account to transfer to. So it completes
      // like a synchronous charge and carries the panel's values through to the host.
      case 'display':
        ctx.onComplete({
          isSuccess: true,
          paymentReference: data.paymentReference ?? '',
          display: data.action.payload,
        });
        break;
      default:
        // A PaymentResponse came back for an action no surface can drive.
        ctx.onError(ctx.texts.paymentFailed, { paymentReference: data.paymentReference });
    }
  } catch {
    ctx.onError(ctx.texts.paymentFailed);
  }
  return true;
}
