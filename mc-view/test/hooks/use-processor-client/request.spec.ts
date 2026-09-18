import {
  orderPaymentsUri,
  paymentIntentsUri,
} from '../../../src/hooks/use-processor-client/request';

const PROCESSOR = 'https://processor.example.test';

describe('orderPaymentsUri', () => {
  it('builds the order-payments read URL from the external API base', () => {
    expect(orderPaymentsUri(PROCESSOR, 'order-1')).toBe(
      `${PROCESSOR}/operations/orders/order-1/payments`
    );
  });

  it('escapes the order id it is handed', () => {
    expect(orderPaymentsUri(PROCESSOR, 'a/../b')).toBe(
      `${PROCESSOR}/operations/orders/a%2F..%2Fb/payments`
    );
  });
});

describe('paymentIntentsUri', () => {
  it('builds the payment-intent action URL from the external API base', () => {
    expect(paymentIntentsUri(PROCESSOR, 'payment-1')).toBe(
      `${PROCESSOR}/operations/payments/payment-1/intents`
    );
  });

  it('escapes the payment id it is handed', () => {
    expect(paymentIntentsUri(PROCESSOR, 'a/../b')).toBe(
      `${PROCESSOR}/operations/payments/a%2F..%2Fb/intents`
    );
  });
});
