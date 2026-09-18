/**
 * The enabler mirrors two processor DTOs BY HAND — it re-declares the `POST /payments` request shape
 * and the `GET /operations/payment-config` response shape rather than importing them across the app
 * boundary. This guard pins the EXACT top-level property set of each, so a rename on the processor side
 * fails here in the processor suite rather than silently at a live checkout.
 */
import { describe, expect, it } from '@jest/globals';
import { PaymentRequestSchema } from '../src/infrastructure/http/dtos/enabler/payment.dto';
import { PaymentConfigResponseSchema } from '../src/infrastructure/http/dtos/enabler/payment-config.dto';

describe('enabler-mirrored contract field sets', () => {
  it('PaymentRequestSchema exposes exactly the fields the enabler sends', () => {
    expect(Object.keys(PaymentRequestSchema.properties).sort()).toEqual(
      [
        'collectedCustomer',
        'deviceFingerprintId',
        'locale',
        'paymentMethodCode',
        'resourceId',
        'returnUrl',
        'vendorCustomerId',
      ].sort(),
    );
  });

  it('PaymentConfigResponseSchema exposes exactly the fields the enabler reads', () => {
    expect(Object.keys(PaymentConfigResponseSchema.properties).sort()).toEqual(
      [
        'amount',
        'country',
        'currency',
        'customerType',
        'environment',
        'fractionDigits',
        'locale',
        'paymentMethods',
        'publicKey',
        'shopper',
      ].sort(),
    );
  });
});
