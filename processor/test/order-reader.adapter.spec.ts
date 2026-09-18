/**
 * `OrderReaderAdapter` reads a commercetools Order and its Payments in EXACTLY ONE call.
 *
 * The suite drives the REAL adapter against a mocked apiRoot builder chain
 * (`paymentSDK.ctAPI.client.orders().withId().get().execute()`), counting the executions: the panel read
 * must never degrade into a per-payment fetch (N+1). It also pins the two mappings the orchestration
 * depends on - `store.key` (the cross-store guard) and the expanded `paymentInfo.payments[*].obj`.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { OrderReaderAdapter } from '../src/infrastructure/adapters/order-reader.adapter';

type GetOpts = { queryArgs?: { expand?: string[] } };

/** Mock the orders builder chain and expose the call counters the assertions need. */
function mockOrders(body: unknown) {
  return mockOrdersExecute(jest.fn<() => Promise<unknown>>().mockResolvedValue({ body }));
}

/** Mock the orders builder chain around a caller-supplied `execute` (a resolution OR a rejection). */
function mockOrdersExecute(execute: jest.Mock<() => Promise<unknown>>) {
  const get = jest.fn((opts?: GetOpts) => {
    capturedOpts = opts;
    return { execute };
  });
  const withId = jest.fn((args: { ID: string }) => {
    capturedId = args.ID;
    return { get };
  });
  let capturedId: string | undefined;
  let capturedOpts: GetOpts | undefined;
  const orders = jest.spyOn(paymentSDK.ctAPI.client, 'orders').mockReturnValue({ withId } as never);

  return {
    execute,
    orders,
    id: () => capturedId,
    expand: () => capturedOpts?.queryArgs?.expand,
  };
}

const orderBody = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-1',
  orderNumber: '1001',
  orderState: 'Open',
  totalPrice: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
  store: { typeId: 'store', key: 'store-a' },
  paymentInfo: {
    payments: [
      { typeId: 'payment', id: 'pay-1', obj: { id: 'pay-1', version: 2, transactions: [], custom: { fields: {} } } },
    ],
  },
  ...overrides,
});

describe('core/adapters - OrderReaderAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the order and all its payments in exactly one commercetools call', async () => {
    const client = mockOrders(orderBody());

    const result = await new OrderReaderAdapter().getWithPayments('order-1');

    expect(client.execute).toHaveBeenCalledTimes(1);
    expect(client.orders).toHaveBeenCalledTimes(1);
    expect(client.id()).toBe('order-1');
    expect(client.expand()).toEqual(['paymentInfo.payments[*]']);
    expect(result.payments).toHaveLength(1);
  });

  // The reader returns the order id and its payments and nothing else: every other order field had no
  // reader, and a port that carries what nothing reads invites a caller to trust an unasserted value.
  it('returns the order id and the expanded payments, lifted out of their references', async () => {
    mockOrders(orderBody());

    const result = await new OrderReaderAdapter().getWithPayments('order-1');

    expect(result).toEqual({
      id: 'order-1',
      payments: [{ id: 'pay-1', version: 2, transactions: [], custom: { fields: {} } }],
    });
  });

  it('returns no payments when the order has no paymentInfo, and drops an unresolved reference', async () => {
    mockOrders(orderBody({ paymentInfo: undefined }));
    await expect(new OrderReaderAdapter().getWithPayments('order-1')).resolves.toMatchObject({ payments: [] });

    jest.restoreAllMocks();
    mockOrders(
      orderBody({
        paymentInfo: {
          payments: [
            { typeId: 'payment', id: 'pay-1' },
            { typeId: 'payment', id: 'pay-2', obj: { id: 'pay-2' } },
          ],
        },
      }),
    );

    const result = await new OrderReaderAdapter().getWithPayments('order-1');

    expect(result.payments).toEqual([{ id: 'pay-2' }]);
  });

  /**
   * An operator opening a stale Merchant Center order link is a routine client mistake, not a connector
   * fault: the commercetools 404 is translated HERE into a typed 404 (`skipLog`), so the panel gets a 4xx
   * and the logs stay free of an error-level stack for every mistyped order id.
   */
  it('translates a commercetools 404 into a typed OrderNotFound (404, not logged)', async () => {
    mockOrdersExecute(
      jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(Object.assign(new Error('URI not found: /orders/order-x'), { statusCode: 404 })),
    );

    const read = new OrderReaderAdapter().getWithPayments('order-x');

    await expect(read).rejects.toBeInstanceOf(Errorx);
    await expect(read).rejects.toMatchObject({ code: 'OrderNotFound', httpErrorStatus: 404, skipLog: true });
  });

  it('lets any other commercetools failure through untouched', async () => {
    const failure = Object.assign(new Error('commercetools unavailable'), { statusCode: 503 });
    mockOrdersExecute(jest.fn<() => Promise<unknown>>().mockRejectedValue(failure));

    await expect(new OrderReaderAdapter().getWithPayments('order-1')).rejects.toBe(failure);
  });
});
