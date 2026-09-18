import { describe, expect, it } from '@jest/globals';
import { ProviderError } from '../src/domain';
import { PspError } from '../src/providers/psp';

describe('PspError.fromErrorResponse — normalized vendor error mapping', () => {
  it('maps a full vendor error body (code, message, category, propertyName, errorId)', () => {
    const err = PspError.fromErrorResponse(400, {
      errorId: 'corr-1',
      errors: [
        {
          code: '30001',
          message: 'Card refused',
          category: 'PAYMENT_PLATFORM_ERROR',
          propertyName: 'cardNumber',
        },
      ],
    });

    expect(err.statusCode).toBe(400);
    expect(err.errorId).toBe('corr-1');
    expect(err.vendorErrors[0]).toEqual({
      code: '30001',
      message: 'Card refused',
      category: 'PAYMENT_PLATFORM_ERROR',
      propertyName: 'cardNumber',
    });
    expect(err.message).toContain('Card refused');
  });

  it('stringifies a numeric error code', () => {
    const err = PspError.fromErrorResponse(500, { errors: [{ code: 9002 }] });
    expect(err.vendorErrors[0]?.code).toBe('9002');
    expect(err.vendorErrors[0]?.message).toBeUndefined();
  });

  it('uses the transport status and a generic summary when the vendor supplies no error items', () => {
    const err = PspError.fromErrorResponse(503, {});
    expect(err.statusCode).toBe(503);
    expect(err.vendorErrors).toEqual([]);
    expect(err.errorId).toBeUndefined();
    // The message is the operator-facing sentence, so a vendor that named nothing gets one too.
    expect(err.message).toBe('The payment provider refused the request.');
  });

  it('treats a null body as an empty error body (never throws)', () => {
    const err = PspError.fromErrorResponse(500, null);
    expect(err.statusCode).toBe(500);
    expect(err.vendorErrors).toEqual([]);
  });

  it('leaves optional fields undefined when the vendor error item omits them', () => {
    const err = PspError.fromErrorResponse(400, { errors: [{ code: 'X' }] });
    expect(err.vendorErrors[0]).toEqual({
      code: 'X',
      message: undefined,
      category: undefined,
      propertyName: undefined,
    });
  });
});

/**
 * `ProviderError.statusCode` is the SOLE input to the core's release decision (`isDefiniteRefusal`): a
 * 4xx means the vendor ANSWERED and did nothing, so the reserved money may be handed back. That decision
 * must therefore be made on what the TRANSPORT observed — never on a number the vendor puts INSIDE its
 * error body, which is data from an external API and, on the refund path, decides whether the same money
 * can be sent a second time.
 */
describe('the status the release decision reads is the TRANSPORT status', () => {
  it('a vendor 500 whose error item claims a 4xx inside the body is a 500 — the refund may well have happened', () => {
    const err = PspError.fromErrorResponse(500, {
      errorId: 'corr-9',
      // `httpStatusCode` is not a field of the normalized error contract; a vendor body carrying one
      // must not be able to smuggle a status into the release decision.
      errors: [{ code: '9999', message: 'Internal error', httpStatusCode: 400 }],
    });

    // Reading the 400 here would release the reservation, return the headroom, and let the operator
    // refund the same money twice.
    expect(err.statusCode).toBe(500);
    // The undeclared body field never survives normalization.
    expect(err.vendorErrors[0]).toEqual({
      code: '9999',
      message: 'Internal error',
      category: undefined,
      propertyName: undefined,
    });
  });

  it('a genuine vendor 400 is a 400 — a real refusal still releases the money', () => {
    const err = PspError.fromErrorResponse(400, {
      errors: [{ code: '30001', message: 'amount exceeds the refundable balance' }],
    });

    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('amount exceeds the refundable balance');
  });
});

describe('PspError.fromTransport — transport rejection wrapping', () => {
  it('uses the Error message for a transport-level Error cause and classifies it 502', () => {
    const err = PspError.fromTransport(new Error('ECONNRESET'));
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('ECONNRESET');
  });

  it('uses a generic reason for a non-Error cause (never leaks the raw cause)', () => {
    const err = PspError.fromTransport('just a string');
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('transport error');
    expect(err.message).not.toContain('just a string');
  });

  it('is an instanceof Error and PspError', () => {
    const err = PspError.fromTransport(undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PspError);
  });
});

describe('PspError.timedOut — the ambiguous outcome', () => {
  it('classifies a timeout as 504 — outside the 4xx band, so the core never reads it as a refusal', () => {
    const err = PspError.timedOut(30000);
    expect(err.statusCode).toBe(504);
    expect(err.message).toContain('30000ms');
  });

  it('is a ProviderError — the domain type the core classifier reads', () => {
    expect(PspError.timedOut(30000)).toBeInstanceOf(ProviderError);
  });
});
