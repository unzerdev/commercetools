/**
 * `PaymentRequestSchema` boundary contract (flat shape): `paymentMethodCode` and `returnUrl` are
 * required and `resourceId` is optional at the transport (the orchestration is what refuses a request
 * that carries none). The legacy `mode` / `hostedTokenizationId` / `selectedMethodKey` fields are gone.
 */
import { describe, expect, it } from '@jest/globals';
import { Value } from '@sinclair/typebox/value';
import { PaymentRequestSchema } from '../src/infrastructure/http/dtos/enabler/payment.dto';

const base = { paymentMethodCode: 'card', returnUrl: 'https://shop.test/return' };

describe('PaymentRequestSchema — flat contract', () => {
  it('accepts a fresh payment carrying a resourceId', () => {
    expect(Value.Check(PaymentRequestSchema, { ...base, resourceId: 's-pay-1' })).toBe(true);
  });

  it('accepts optional device + locale', () => {
    expect(
      Value.Check(PaymentRequestSchema, {
        ...base,
        resourceId: 's-pay-1',
        locale: 'de-DE',
        device: { userAgent: 'ua' },
      }),
    ).toBe(true);
  });

  it('rejects a request with no paymentMethodCode', () => {
    expect(Value.Check(PaymentRequestSchema, { returnUrl: 'https://shop.test/return', resourceId: 's-pay-1' })).toBe(
      false,
    );
  });

  it('rejects a request with no returnUrl', () => {
    expect(Value.Check(PaymentRequestSchema, { paymentMethodCode: 'card', resourceId: 's-pay-1' })).toBe(false);
  });

  it('rejects an over-long paymentMethodCode (bounded shopper string)', () => {
    expect(
      Value.Check(PaymentRequestSchema, { ...base, resourceId: 's-pay-1', paymentMethodCode: 'x'.repeat(200) }),
    ).toBe(false);
  });

  it('rejects an over-long resourceId, returnUrl and locale (bounded shopper strings)', () => {
    expect(Value.Check(PaymentRequestSchema, { ...base, resourceId: 'x'.repeat(300) })).toBe(false);
    expect(
      Value.Check(PaymentRequestSchema, {
        ...base,
        resourceId: 's-pay-1',
        returnUrl: `https://shop.test/${'x'.repeat(3000)}`,
      }),
    ).toBe(false);
    expect(Value.Check(PaymentRequestSchema, { ...base, resourceId: 's-pay-1', locale: 'x'.repeat(100) })).toBe(false);
  });

  it('rejects the removed mode discriminator as an unknown property is ignored but a missing code still fails', () => {
    // TypeBox object schemas are non-strict by default: an extra `mode` is ignored, but the contract
    // still requires paymentMethodCode + returnUrl, so a legacy `{ mode }`-only body fails.
    expect(Value.Check(PaymentRequestSchema, { mode: 'hosted-checkout' })).toBe(false);
  });
});
