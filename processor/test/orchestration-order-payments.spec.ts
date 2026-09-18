/**
 * `getOrderPayments`: the Merchant Center panel's whole read.
 *
 * Asserts the four properties the panel rests on: the order's store is the AUTHORIZATION gate (an order
 * outside a store is 403), the PSP credentials are the ones the PAYMENT was created under (the
 * same key the action route derives, so the panel reads the account the action writes to), the amounts come
 * from the already-loaded CT transactions, and a provider failure degrades ONE payment's details while the
 * rest of the view still renders. The call budget — 1 commercetools order read, 1 config read per DISTINCT
 * store key and 1 vendor call per connector-owned payment, nothing per transaction — is asserted explicitly.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getOrderPayments } from '../src/application/orchestration';
import type { OrderWithPayments } from '../src/application/ports';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

const CONNECTOR_INTERFACE = 'psp';

/**
 * A connector-owned CT Payment: the `storeKey` custom field BOTH writers stamp (the ownership test),
 * a vendor reference, transactions, custom fields.
 */
function ownedPayment(overrides: Record<string, unknown> = {}): any {
  return fakePayment({
    id: 'pay-1',
    interfaceId: 'wl-1',
    paymentMethodInfo: { paymentInterface: CONNECTOR_INTERFACE, method: 'VISA' },
    transactions: [
      {
        id: 'tx-1',
        type: 'Charge',
        state: 'Success',
        amount: { centAmount: 1000, currencyCode: 'EUR' },
        interactionId: 'op-1',
        timestamp: '2026-07-10T10:00:00.000Z',
      },
    ],
    custom: { fields: { merchantReference: 'WL-0001', inReview: true, storeKey: 'store-a' } },
    ...overrides,
  });
}

/** Another PSP's payment: no `storeKey` custom field of ours, and not our `paymentInterface` either. */
function foreignPayment(overrides: Record<string, unknown> = {}): any {
  return fakePayment({
    id: 'pay-x',
    interfaceId: 'other-1',
    paymentMethodInfo: { paymentInterface: 'other-psp' },
    custom: { fields: {} },
    ...overrides,
  });
}

function order(overrides: Partial<OrderWithPayments> = {}): OrderWithPayments {
  return {
    id: 'order-1',
    payments: [ownedPayment()],
    ...overrides,
  };
}

describe('getOrderPayments', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv({ brand: { paymentInterface: CONNECTOR_INTERFACE } });

  const givenOrder = (value: OrderWithPayments): void => {
    ports.orderReader.getWithPayments = jest.fn<typeof ports.orderReader.getWithPayments>().mockResolvedValue(value);
  };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();

    // The resolved config ECHOES the key it was resolved for, so a spec can assert WHICH store's
    // credentials reached the vendor call — not merely that some config did.
    const resolve = ports.configResolver.resolve;
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockImplementation(async (storeKey) => ({ ...(await resolve(storeKey)), storeKey }));
  });

  test('renders the payment, its headroom and the provider details (happy path)', async () => {
    givenOrder(order());

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toHaveLength(1);
    expect(view.payments[0]).toMatchObject({
      id: 'pay-1',
      providerPaymentId: 'wl-1',
      merchantReference: 'WL-0001',
      inReview: true,
      paymentMethod: 'VISA',
      amountPlanned: { centAmount: 1500, currencyCode: 'EUR' },
      details: {
        displayStatus: 'CAPTURED',
        orderId: 'ct-pay-1',
      },
    });
  });

  /**
   * The panel renders and submits minor-unit integers, so it has to know the currency's exponent. Every
   * amount of one payment is in that payment's currency, so the view states the exponent once per payment
   * — and it is the figure commercetools holds on `amountPlanned`, never one the browser resolves from a
   * locale: CLDR answers 0 minor digits for `RSD` where commercetools stores 2. A three-digit currency
   * proves the figure is read rather than assumed, since neither 2 nor a CLDR lookup for `EUR` yields 3.
   */
  test('carries the minor-unit exponent commercetools states on the payment', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            amountPlanned: { centAmount: 1500, currencyCode: 'KWD', type: 'centPrecision', fractionDigits: 3 },
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments[0].fractionDigits).toBe(3);
  });

  // the credentials a payment is READ through must be the ones it was CREATED with, and the store
  // key it was created under is the one stamped on the payment itself — never the order's CT store, which
  // differs from it by construction whenever the deployment is not scoped to that store. Reading through
  // another account's credentials fails every provider call, and a payment whose details never fetch is a
  // payment whose standing reservation can never be reconciled: the headroom stays shut forever.
  test('resolves the config of the store stamped on the PAYMENT, which is the only store the reader has', async () => {
    givenOrder(order());

    await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(ports.configResolver.resolve).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-a');
    expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
  });

  test('the vendor is called with the credentials of the store stamped on the payment', async () => {
    givenOrder(order());

    await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(
      expect.objectContaining({ storeKey: 'store-a' }),
      'wl-1',
    );
  });

  test('each payment is read through its OWN store’s config, resolved once per distinct key', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({ id: 'pay-1', interfaceId: 'wl-1' }),
          ownedPayment({ id: 'pay-2', interfaceId: 'wl-2' }),
          ownedPayment({
            id: 'pay-3',
            interfaceId: 'wl-3',
            custom: { fields: { storeKey: 'store-c' } },
          }),
        ],
      }),
    );

    await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(ports.configResolver.resolve).toHaveBeenCalledTimes(2);
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-a');
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-c');
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(
      expect.objectContaining({ storeKey: 'store-a' }),
      'wl-1',
    );
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(
      expect.objectContaining({ storeKey: 'store-a' }),
      'wl-2',
    );
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(
      expect.objectContaining({ storeKey: 'store-c' }),
      'wl-3',
    );
  });

  test('aggregates the capture and refund headroom from the loaded CT transactions', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
            transactions: [
              { id: 't0', type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
              { id: 't1', type: 'Charge', state: 'Success', amount: { centAmount: 1000, currencyCode: 'EUR' } },
              { id: 't3', type: 'Refund', state: 'Success', amount: { centAmount: 400, currencyCode: 'EUR' } },
              { id: 't4', type: 'Refund', state: 'Failure', amount: { centAmount: 600, currencyCode: 'EUR' } },
            ],
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    // 1500 authorized, 1000 settled and 400 given back: 500 left to capture, 600 left to refund. The
    // failed refund of 600 releases its headroom rather than counting against it.
    expect(view.payments[0]).toMatchObject({
      capturableAmount: { centAmount: 500, currencyCode: 'EUR' },
      refundableAmount: { centAmount: 600, currencyCode: 'EUR' },
    });
  });

  test('an in-flight capture consumes the capture headroom and is not yet refundable', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
            transactions: [
              { id: 't0', type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
              { id: 't1', type: 'Charge', state: 'Pending', amount: { centAmount: 500, currencyCode: 'EUR' } },
            ],
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments[0]).toMatchObject({
      capturableAmount: { centAmount: 1000, currencyCode: 'EUR' },
      refundableAmount: { centAmount: 0, currencyCode: 'EUR' },
    });
  });

  test('a successful cancel consumes the capture headroom', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
            transactions: [
              { id: 't0', type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
              {
                id: 't1',
                type: 'CancelAuthorization',
                state: 'Success',
                amount: { centAmount: 1500, currencyCode: 'EUR' },
              },
            ],
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments[0]).toMatchObject({
      capturableAmount: { centAmount: 0, currencyCode: 'EUR' },
      refundableAmount: { centAmount: 0, currencyCode: 'EUR' },
    });
  });

  test('a provider failure degrades THAT payment to unavailable + reason; the rest of the view still renders', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({ id: 'pay-1', interfaceId: 'wl-1' }),
          ownedPayment({ id: 'pay-2', interfaceId: 'wl-2' }),
        ],
      }),
    );
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockImplementation(async (_cfg, providerPaymentId) => {
        if (providerPaymentId === 'wl-1') {
          throw new Error('vendor unreachable');
        }
        return { displayStatus: 'CAPTURED', operations: [] };
      });

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toHaveLength(2);
    expect(view.payments[0].details).toEqual({ unavailable: true, reason: expect.any(String) });
    // The commercetools-sourced headroom is intact: only the provider read failed. This fixture's
    // 1000 settled capture is refundable whether or not the vendor answered.
    expect(view.payments[0].refundableAmount).toEqual({ centAmount: 1000, currencyCode: 'EUR' });
    expect(view.payments[1].details).toEqual({ displayStatus: 'CAPTURED', operations: [] });
  });

  // Pairing each payment with ITS OWN vendor read is what makes the fence honest: a row that renders
  // another payment's vendor status misreports where the money is, and a failure BETWEEN two healthy
  // payments is exactly where a positional correlation slips without any type complaining.
  test('each payment carries its own vendor details, with a failing payment between two healthy ones', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({ id: 'pay-1', interfaceId: 'wl-1' }),
          ownedPayment({ id: 'pay-2', interfaceId: 'wl-2' }),
          ownedPayment({ id: 'pay-3', interfaceId: 'wl-3' }),
        ],
      }),
    );
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockImplementation(async (_cfg, providerPaymentId) => {
        if (providerPaymentId === 'wl-2') {
          throw new Error('vendor unreachable');
        }
        return { displayStatus: `CAPTURED-${providerPaymentId}`, operations: [] };
      });

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments.map((p) => p.id)).toEqual(['pay-1', 'pay-2', 'pay-3']);
    expect(view.payments[0].details).toEqual({ displayStatus: 'CAPTURED-wl-1', operations: [] });
    expect(view.payments[1].details).toEqual({ unavailable: true, reason: expect.any(String) });
    expect(view.payments[2].details).toEqual({ displayStatus: 'CAPTURED-wl-3', operations: [] });
  });

  test('a details object carrying only the guaranteed fields passes through verbatim', async () => {
    givenOrder(order());
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockResolvedValue({ displayStatus: 'PENDING_CAPTURE', operations: [] });

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments[0].details).toEqual({ displayStatus: 'PENDING_CAPTURE', operations: [] });
  });

  // An order in no store is the DEFAULT-SCOPE order, the same path a storeless cart takes end to end: the
  // create leg resolves `env.default` and stamps the PROJECT KEY on the Payment, and the return leg and the
  // webhook resolve it back to `env.default`. Refusing it here was the one break in that chain - the
  // connector charged and settled a payment it then declined to show.
  // The order carries no store of its own: ownership is the PAYMENT's own stamped key, so an order in no
  // store is the default-scope order rather than a forbidden one.
  test('an order is served from its payments own stamped store key', async () => {
    givenOrder(order());

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toHaveLength(1);
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-a');
  });

  // Ownership is the payment's own stamped key, so an order carrying only another connector's payments
  // renders empty and reaches no provider.
  test('an order carrying only foreign payments renders empty and calls no provider', async () => {
    givenOrder(order({ payments: [foreignPayment()] }));

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toEqual([]);
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(provider.introspection.paymentDetails).not.toHaveBeenCalled();
  });

  test('foreign payments are excluded: an order with none of ours renders an empty payment list and calls no provider', async () => {
    givenOrder(order({ payments: [foreignPayment()] }));

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toEqual([]);
    expect(provider.introspection.paymentDetails).not.toHaveBeenCalled();
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
  });

  // Ownership is the `storeKey` custom field — the SAME test the action route (`applyMerchantIntent`)
  // already enforces — so everything the panel lists is by construction actionable, and everything it
  // hides would have been refused anyway. `paymentInterface` cannot carry that test: the certified
  // `/operations/transactions` route stamps Checkout's connector uuid there, not the brand string.
  test('a payment created by /operations/transactions is listed: it carries storeKey, though its paymentInterface is a FOREIGN uuid', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            id: 'pay-tx',
            interfaceId: 'wl-tx',
            paymentMethodInfo: { paymentInterface: '2f9a1c34-9b7e-4d1a-8f2b-6c5d4e3a2b10' },
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments.map((p) => p.id)).toEqual(['pay-tx']);
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(expect.anything(), 'wl-tx');
  });

  test('a payment carrying our paymentInterface but NO storeKey is NOT listed: the action route would 403 it, so the panel must not offer it', async () => {
    givenOrder(
      order({
        payments: [
          ownedPayment({
            id: 'pay-orphan',
            custom: { fields: { merchantReference: 'WL-0009' } },
          }),
        ],
      }),
    );

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toEqual([]);
    expect(provider.introspection.paymentDetails).not.toHaveBeenCalled();
  });

  test('an empty storeKey is not ownership either (no falsy shortcut passes)', async () => {
    givenOrder(order({ payments: [ownedPayment({ custom: { fields: { storeKey: '' } } })] }));

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments).toEqual([]);
  });

  test('a connector payment with no vendor reference is unavailable, and costs no vendor call', async () => {
    givenOrder(order({ payments: [ownedPayment({ interfaceId: undefined })] }));

    const view = await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(view.payments[0].details).toEqual({ unavailable: true, reason: expect.any(String) });
    expect(provider.introspection.paymentDetails).not.toHaveBeenCalled();
  });

  test('call budget: 1 order read + 1 config read per distinct store + 1 vendor call per payment, nothing per transaction', async () => {
    const manyTransactions = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      type: 'Charge',
      state: 'Success',
      amount: { centAmount: 100, currencyCode: 'EUR' },
    }));
    givenOrder(
      order({
        payments: [
          ownedPayment({ id: 'pay-1', interfaceId: 'wl-1', transactions: manyTransactions }),
          ownedPayment({ id: 'pay-2', interfaceId: 'wl-2', transactions: manyTransactions }),
          foreignPayment(),
        ],
      }),
    );

    await getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

    expect(ports.orderReader.getWithPayments).toHaveBeenCalledTimes(1);
    expect(ports.orderReader.getWithPayments).toHaveBeenCalledWith('order-1');
    expect(ports.paymentStore.get).not.toHaveBeenCalled();
    expect(ports.configResolver.resolve).toHaveBeenCalledTimes(1);
    expect(provider.introspection.paymentDetails).toHaveBeenCalledTimes(2);
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(expect.anything(), 'wl-1');
    expect(provider.introspection.paymentDetails).toHaveBeenCalledWith(expect.anything(), 'wl-2');
  });
});
