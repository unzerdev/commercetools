import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { postPaymentAndFollowUp } from '../src/components/post-payment';
import { PaymentRequest } from '../src/dtos/payment.dto';
import { ActionRequired, PaymentResult } from '../src/payment-enabler/payment-enabler';
import { resolveShopperTexts } from '../src/locale';
import {
  errorResponse,
  FetchMock,
  installFetchMock,
  installLocationMock,
  LocationMock,
  okJson,
  readCall,
} from './helpers';

/**
 * The charge both shipped surfaces make: `POST /payments` plus the follow-up action the processor
 * answers with. The return value is the SPENT decision — true once a PaymentResponse came back, so the
 * caller can never re-post an instrument a CT Payment already exists for.
 */
describe('postPaymentAndFollowUp', () => {
  let fetchMock: FetchMock;
  let location: LocationMock;
  let restoreLocation: () => void;

  const texts = resolveShopperTexts('en-GB');
  const body: PaymentRequest = {
    paymentMethodCode: 'card',
    resourceId: 's-crd-1',
    returnUrl: 'https://storefront.example/checkout',
  };

  const context = () => {
    const onComplete = jest.fn<(result: PaymentResult) => void>();
    const onError = jest.fn<(error: unknown, ctx?: { paymentReference?: string }) => void>();
    const onActionRequired = jest.fn<(action: ActionRequired) => void>();
    return {
      onComplete,
      onError,
      onActionRequired,
      ctx: {
        processorUrl: 'https://proc.example',
        sessionId: 'sess-123',
        texts,
        onComplete,
        onError,
        onActionRequired,
      },
    };
  };

  beforeEach(() => {
    fetchMock = installFetchMock();
    const mock = installLocationMock();
    location = mock.location;
    restoreLocation = mock.restore;
  });

  afterEach(() => {
    restoreLocation();
    jest.clearAllMocks();
  });

  it('posts the request under the session credential and navigates a redirect follow-up', async () => {
    const { ctx, onActionRequired } = context();
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds' } } }),
    );

    const spent = await postPaymentAndFollowUp(ctx, body);

    const call = readCall(fetchMock, 0);
    expect(call.url).toBe('https://proc.example/payments');
    expect(call.method).toBe('POST');
    expect(call.headers['X-Session-Id']).toBe('sess-123');
    expect(call.body).toEqual(body);
    // The host is NOTIFIED before the shopper leaves the page, in the reference connectors' own
    // vocabulary, and the notification is not a permission gate.
    expect(onActionRequired).toHaveBeenCalledTimes(1);
    expect(onActionRequired).toHaveBeenCalledWith({ type: 'fullscreen' });
    expect(location.assign).toHaveBeenCalledWith('https://unzer.test/3ds');
    expect(spent).toBe(true);
  });

  it('completes a `none` follow-up with the payment reference', async () => {
    const { ctx, onComplete } = context();
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'none' } }));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onComplete).toHaveBeenCalledWith({ isSuccess: true, paymentReference: 'pay-1' });
    expect(spent).toBe(true);
  });

  // An action no surface can drive still means a CT Payment exists: the caller must not re-post.
  it('reports an undrivable action with its payment reference and still counts as spent', async () => {
    const { ctx, onError } = context();
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'sdkAction', payload: {} } }));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onError).toHaveBeenCalledWith(texts.paymentFailed, { paymentReference: 'pay-1' });
    expect(spent).toBe(true);
  });

  /**
   * A method that takes NO MONEY at checkout - Prepayment, Invoice - answers with the account the shopper must
   * transfer to. The payment succeeded as far as the vendor is concerned, so it completes like a
   * synchronous charge; what is different is that the panel's values reach the host VERBATIM, because the
   * shopper cannot pay without them.
   */
  it('completes a display action and carries its payload to the host', async () => {
    const { ctx, onComplete, onError, onActionRequired } = context();
    const payload = { instruction: 'bank-transfer', iban: 'DE89370400440532013000', holder: 'Unzer GmbH' };
    fetchMock.mockResolvedValueOnce(okJson({ paymentReference: 'pay-1', action: { kind: 'display', payload } }));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onComplete).toHaveBeenCalledWith({ isSuccess: true, paymentReference: 'pay-1', display: payload });
    // Neither redirected nor refused: a display action is a completion with a message.
    expect(onError).not.toHaveBeenCalled();
    expect(onActionRequired).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  /**
   * The redirect target is the one value this library NAVIGATES by, and it comes from the vendor by way of
   * the processor. `location.assign('javascript:…')` executes in the merchant page's own context, so the
   * scheme is checked even though the source is a trusted server - and a refused target is still SPENT,
   * because the charge behind it already happened.
   */
  it.each([
    ['a javascript: target', 'javascript:alert(document.cookie)'],
    ['a data: target', 'data:text/html,<script>alert(1)</script>'],
    ['a blob: target', 'blob:https://storefront.example/2b0f'],
  ])('refuses %s without navigating, and still counts as spent', async (_case, url) => {
    const { ctx, onError, onComplete } = context();
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url } } }),
    );

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(location.assign).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(texts.paymentFailed, { paymentReference: 'pay-1' });
    expect(onComplete).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  it('navigates a relative redirect target resolved against the page', async () => {
    const { ctx } = context();
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: '/3ds/challenge' } } }),
    );

    await postPaymentAndFollowUp(ctx, body);

    // Resolved, not passed through: the assign gets an absolute URL either way.
    expect(location.assign).toHaveBeenCalledWith(expect.stringContaining('/3ds/challenge'));
  });

  it('leaves the surface unspent when the processor refuses the charge', async () => {
    const { ctx, onError, onComplete } = context();
    fetchMock.mockResolvedValueOnce(errorResponse(502));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onError).toHaveBeenCalledWith(texts.paymentFailed);
    expect(onComplete).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
    expect(spent).toBe(false);
  });

  it('leaves the surface unspent when the request never reaches the processor', async () => {
    const { ctx, onError } = context();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onError).toHaveBeenCalledWith(texts.paymentFailed);
    expect(spent).toBe(false);
  });

  // A 2xx carries a charged payment even when its body names no action this surface can read, so the
  // instrument is spent: re-posting it would charge the shopper a second time.
  it('counts a 2xx whose body carries no action as spent', async () => {
    const { ctx, onError, onComplete } = context();
    fetchMock.mockResolvedValueOnce(okJson({}));

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onError).toHaveBeenCalledWith(texts.paymentFailed);
    expect(onComplete).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  // A gateway that replaces a 200 body with an HTML error page, a truncated chunked answer or a
  // `Content-Encoding` mismatch says nothing about whether the vendor was charged — and the 2xx says it
  // was. An unreadable body therefore spends the instrument exactly as an unreadable action does.
  it('counts a 2xx whose body cannot be read as spent', async () => {
    const { ctx, onError, onComplete } = context();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) });

    const spent = await postPaymentAndFollowUp(ctx, body);

    expect(onError).toHaveBeenCalledWith(texts.paymentFailed);
    expect(onComplete).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  // The notification is not a gate: the host owns its own layout, never the question of whether a charge
  // that already happened is followed through. A hook that REJECTS must therefore cost the shopper
  // nothing — the navigation still happens and no failure is reported.
  it('navigates anyway when the host action hook rejects', async () => {
    const { onComplete, onError } = context();
    const rejecting = {
      processorUrl: 'https://proc.example',
      sessionId: 'sess-123',
      texts,
      onComplete,
      onError,
      onActionRequired: () => Promise.reject(new Error('host failed')) as unknown as void,
    };
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds' } } }),
    );

    const spent = await postPaymentAndFollowUp(rejecting, body);

    expect(location.assign).toHaveBeenCalledWith('https://unzer.test/3ds');
    expect(onError).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  /**
   * The host that sets NO hook, which is the common case: the canonical template declares
   * `onActionRequired` and never calls it, and the reference connectors never call it either, so a host
   * written against either sets nothing. The notification has to be a no-op for it and the navigation has
   * to happen all the same.
   */
  it('navigates when the host set no action hook at all', async () => {
    const { onComplete, onError } = context();
    const hookless = { processorUrl: 'https://proc.example', sessionId: 'sess-123', texts, onComplete, onError };
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds' } } }),
    );

    const spent = await postPaymentAndFollowUp(hookless, body);

    expect(location.assign).toHaveBeenCalledWith('https://unzer.test/3ds');
    expect(onError).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  // The same rule for the synchronous half: a hook that throws on the call stack cannot take the
  // navigation down with it.
  it('navigates anyway when the host action hook throws synchronously', async () => {
    const { onComplete, onError } = context();
    const throwing = {
      processorUrl: 'https://proc.example',
      sessionId: 'sess-123',
      texts,
      onComplete,
      onError,
      onActionRequired: (): void => {
        throw new Error('host failed');
      },
    };
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds' } } }),
    );

    const spent = await postPaymentAndFollowUp(throwing, body);

    expect(location.assign).toHaveBeenCalledWith('https://unzer.test/3ds');
    expect(onError).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });

  // A hook whose promise never settles must not hold the navigation either: the page has to leave on
  // the same tick the branch decided to leave.
  it('navigates without waiting for a host action hook that never settles', async () => {
    const { onComplete, onError } = context();
    const hanging = {
      processorUrl: 'https://proc.example',
      sessionId: 'sess-123',
      texts,
      onComplete,
      onError,
      onActionRequired: () => new Promise<void>(() => {}) as unknown as void,
    };
    fetchMock.mockResolvedValueOnce(
      okJson({ paymentReference: 'pay-1', action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds' } } }),
    );

    const spent = await postPaymentAndFollowUp(hanging, body);

    expect(location.assign).toHaveBeenCalledWith('https://unzer.test/3ds');
    expect(onError).not.toHaveBeenCalled();
    expect(spent).toBe(true);
  });
});
