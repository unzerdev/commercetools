/**
 * `wrapProviderError` - the one funnel every orchestrator's provider failure passes through (the error
 * contract).
 *
 * Two properties are pinned here, and they pull against each other:
 * - the operator gets a REASON: a provider's TYPED error surfaces its own safe message, so an
 *   outage reads as an outage rather than "Payment provider operation failed.";
 * - nothing else does: the vendor body the typed error was mapped from, the transport request that
 *   carried a credential, and the stack all stay behind the seam — an untyped failure keeps the generic
 *   message and is logged privately.
 *
 * The REAL `PspError` is the provider error under test: a fake one would prove only that the core
 * recognizes a shape the real provider might not have (`PspError extends ProviderError` is exactly
 * the contract that broke this before).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ErrorInvalidOperation, Errorx } from '@commercetools/connect-payments-sdk';
import { type OrchestrationLogger, wrapProviderError } from '../src/application/orchestration';
import { PspError } from '../src/providers/psp/errors';

const makeLogger = (): jest.Mocked<OrchestrationLogger> => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const wrap = (error: unknown, logger: OrchestrationLogger = makeLogger()): Errorx =>
  wrapProviderError(error, 'getOrderPayments', 'psp', logger);

describe('wrapProviderError', () => {
  it('passes an already-typed processor error through untouched', () => {
    const typed = new ErrorInvalidOperation('This payment has nothing left to capture.');
    const logger = makeLogger();

    expect(wrap(typed, logger)).toBe(typed);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('surfaces the provider typed error message as the reason', () => {
    const vendorFailure = PspError.fromErrorResponse(502, {
      errorId: 'err-1',
      errors: [{ errorCode: '50001130', message: 'Payment platform temporarily unavailable' }],
    });

    const wrapped = wrap(vendorFailure);

    expect(wrapped).toBeInstanceOf(Errorx);
    expect(wrapped.message).toBe('Payment platform temporarily unavailable');
  });

  it('surfaces a transport failure as the provider stated it, without the raw cause', () => {
    const wrapped = wrap(PspError.fromTransport(new Error('getaddrinfo ENOTFOUND payment.psp.com')));

    expect(wrapped.message).toBe('PSP request failed: getaddrinfo ENOTFOUND payment.psp.com');
  });

  it('never lets the vendor body, a credential or a stack out of the provider error', () => {
    const vendorFailure = PspError.fromErrorResponse(400, {
      errorId: 'err-2',
      privateKey: 'sk_live_SUPERSECRET',
      errors: [{ errorCode: '20000000', message: 'Value is invalid', propertyName: 'cardNumber' }],
      request: { headers: { Authorization: 'Basic GCS:sk_live_SUPERSECRET' } },
    });

    const wrapped = wrap(vendorFailure);

    expect(wrapped.message).not.toContain('sk_live_SUPERSECRET');
    expect(wrapped.message).not.toContain('Authorization');
    expect(wrapped.message).not.toContain('at Object.');
    expect(wrapped.message).toBe('Value is invalid');
  });

  it('logs the provider failure privately — the message only, never the error object', () => {
    const logger = makeLogger();

    wrap(PspError.fromTransport(new Error('socket hang up')), logger);

    expect(logger.error).toHaveBeenCalledWith("Provider operation 'getOrderPayments' failed", {
      error: 'PSP request failed: socket hang up',
    });
  });

  /**
   * A vendor 4xx is the vendor ANSWERING: the request was understood and refused (an amount beyond the
   * refundable balance, an unknown payment). Collapsing it into a 500 tells the operator the connector is
   * broken and buries the refusal in the error log next to real outages.
   */
  describe('a vendor REFUSAL (4xx) is an answer, not an outage', () => {
    it('surfaces the vendor 4xx as a 4xx carrying the vendor’s own sanitized reason', () => {
      const refusal = PspError.fromErrorResponse(400, {
        errorId: 'err-3',
        errors: [{ errorCode: '30051001', message: 'amount exceeds the refundable balance' }],
      });

      const wrapped = wrap(refusal);

      expect(wrapped.httpErrorStatus).toBe(400);
      expect(wrapped.message).toBe('amount exceeds the refundable balance');
    });

    it('logs the refusal as a warning — the error log is for failures, not for answers', () => {
      const logger = makeLogger();

      wrap(PspError.fromErrorResponse(404, { errors: [{ errorCode: '404', message: 'Unknown payment' }] }), logger);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('never lets the vendor body out with the refusal', () => {
      const refusal = PspError.fromErrorResponse(400, {
        errorId: 'err-4',
        privateKey: 'sk_live_SUPERSECRET',
        errors: [{ errorCode: '20000000', message: 'Value is invalid', propertyName: 'cardNumber' }],
        request: { headers: { Authorization: 'Basic GCS:sk_live_SUPERSECRET' } },
      });

      const wrapped = wrap(refusal);

      expect(wrapped.message).toBe('Value is invalid');
      expect(JSON.stringify(wrapped.fields ?? {})).not.toContain('sk_live_SUPERSECRET');
    });

    // The reservation's release decision reads the TYPED error off the wrapper's `cause`
    // (`merchant-intent.ts::isDefiniteRefusal`) — a wrapper that drops it would leave every refused leg
    // standing and the headroom shut.
    it('keeps the typed provider error as the cause, which is what the release decision reads', () => {
      const refusal = PspError.fromErrorResponse(400, { errors: [{ errorCode: '1', message: 'no' }] });

      expect(wrap(refusal).cause).toBe(refusal);
    });

    // 401/403 are OUR OWN verdicts on the caller at this API's boundary ("your token is invalid", "not
    // yours"); a vendor whose credentials WE hold must never be able to mint them, or the panel logs the
    // operator out over a connector misconfiguration.
    it('does not let the vendor forge this API’s own authentication verdicts', () => {
      const vendorAuth = PspError.fromErrorResponse(403, {
        errors: [{ errorCode: '9002', message: 'Authentication failed' }],
      });

      const wrapped = wrap(vendorAuth);

      expect(wrapped.httpErrorStatus).toBe(400);
      expect(wrapped.message).toBe('Authentication failed');
    });

    it('leaves a vendor 5xx and a transport failure a 500 — nobody answered', () => {
      const outage = PspError.fromErrorResponse(502, {
        errors: [{ errorCode: '50001130', message: 'Payment platform temporarily unavailable' }],
      });

      expect(wrap(outage).httpErrorStatus).toBe(500);
      expect(wrap(PspError.fromTransport(new Error('socket hang up'))).httpErrorStatus).toBe(500);
    });

    // 408 and 409 are the two 4xx that ANSWER NOTHING: a request timeout is a request the vendor may still
    // be completing, and a conflict on our own idempotency key means it already holds an operation under
    // this very name — money that may be gone. The reservation leaves their leg STANDING for exactly that
    // reason, so they must not leave here dressed as a refusal: a refusal is what the money path and the
    // panel both read as "nothing moved, retry".
    it.each([408, 409])('does not dress an AMBIGUOUS vendor %s as a refusal — nobody answered', (statusCode) => {
      const logger = makeLogger();
      const ambiguous = PspError.fromErrorResponse(statusCode, {
        errors: [{ errorCode: '1', message: 'The operation is already in progress' }],
      });

      const wrapped = wrap(ambiguous, logger);

      expect(wrapped.httpErrorStatus).toBe(500);
      expect(wrapped.code).not.toBe('ProviderRefusedOperation');
      // It is a failure, not an answer: it belongs in the error log with the outages.
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
      // The typed error still rides on the cause — it is what the release decision reads to leave the leg up.
      expect(wrapped.cause).toBe(ambiguous);
    });
  });

  it('keeps an UNtyped failure generic — an unknown throw explains nothing to the caller', () => {
    const logger = makeLogger();

    const wrapped = wrap(new Error('Bearer sk_live_SUPERSECRET rejected by https://vendor.test'), logger);

    expect(wrapped.message).toBe('Payment provider operation failed.');
    expect(wrapped.message).not.toContain('sk_live_SUPERSECRET');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
