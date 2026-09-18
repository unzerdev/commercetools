/**
 * `GET /operations/orders/:orderId/payments`: the Merchant Center panel's read route.
 *
 * The route is JWT-authed and takes NO store key — the order decides which store is served — so these
 * specs drive the REAL route + REAL `createStoreAuthorization` and pin the three properties the panel
 * rests on: the manage permission gates the read, every panel field reaches the wire, and the wire schema
 * is the last line of defence against a card number escaping: even a provider that hands
 * the core an unmasked PAN in an unknown field cannot get it serialized.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { type FastifyInstance } from 'fastify';
import type { StoreAuthorizationDeps } from '../src/infrastructure/http/authorization/store-authorization';
import type { OrderWithPayments } from '../src/application/ports';
import { OrderReaderAdapter } from '../src/infrastructure/adapters/order-reader.adapter';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { PspError } from '../src/providers/psp/errors';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { bearerWithPermissions, buildOperationsApp, manageHeaders } from './support/operations-app';

const ORDER_STORE_KEY = 'store-b';
const CONNECTOR_INTERFACE = 'psp';

/** A connector-owned CT Payment of the order: 1500 authorized, 1000 captured, 400 of that refunded. */
function ownedPayment(overrides: Record<string, unknown> = {}): any {
  return fakePayment({
    id: 'pay-1',
    interfaceId: 'wl-1',
    amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
    paymentMethodInfo: { paymentInterface: CONNECTOR_INTERFACE, method: 'VISA' },
    transactions: [
      { id: 'tx-0', type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
      {
        id: 'tx-1',
        type: 'Charge',
        state: 'Success',
        amount: { centAmount: 1000, currencyCode: 'EUR' },
        interactionId: 'op-1',
        timestamp: '2026-07-10T10:00:00.000Z',
      },
      { id: 'tx-2', type: 'Refund', state: 'Success', amount: { centAmount: 400, currencyCode: 'EUR' } },
    ],
    custom: { fields: { merchantReference: 'WL-0001', inReview: true, storeKey: ORDER_STORE_KEY } },
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

describe('GET /operations/orders/:orderId/payments', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;

  const buildApp = (): Promise<FastifyInstance> =>
    buildOperationsApp({
      ports,
      provider,
      storeExists,
      env: makeFakeEnv({ brand: { paymentInterface: CONNECTOR_INTERFACE } }),
    });

  const givenOrder = (value: OrderWithPayments): void => {
    ports.orderReader.getWithPayments = jest.fn<typeof ports.orderReader.getWithPayments>().mockResolvedValue(value);
  };

  const get = async (app: FastifyInstance, headers: Record<string, string> = manageHeaders) =>
    app.inject({ method: 'GET', url: '/operations/orders/order-1/payments', headers });

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(true);
    givenOrder(order());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * The REAL `OrderReaderAdapter` over a mocked commercetools client: the 404 translation only holds if
   * the adapter, the orchestration and the error handler agree, so this drives the whole seam rather than
   * a hand-built error the route already expects.
   */
  test('an unknown order → 404, not a 500; the body carries no transport detail (a stale MC link is a client mistake)', async () => {
    const notFound = Object.assign(new Error('URI not found: /orders/order-1'), {
      statusCode: 404,
      body: { statusCode: 404, message: 'The Order with ID "order-1" was not found.' },
      originalRequest: { headers: { Authorization: 'Bearer ct-access-token' } },
    });
    jest.spyOn(paymentSDK.ctAPI.client, 'orders').mockReturnValue({
      withId: () => ({ get: () => ({ execute: () => Promise.reject(notFound) }) }),
    } as never);
    ports.orderReader = new OrderReaderAdapter();
    const app = await buildApp();

    const res = await get(app);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toStrictEqual({
      message: 'The requested order was not found.',
      statusCode: 404,
      errors: [{ code: 'OrderNotFound', message: 'The requested order was not found.' }],
    });
    expect(res.body).not.toContain('ct-access-token');
    await app.close();
  });

  describe('authorization', () => {
    test('WITHOUT the manage permission → 403; the order is never even read', async () => {
      const app = await buildApp();

      const res = await get(app, { authorization: bearerWithPermissions(['canViewPspPayments']) });

      expect(res.statusCode).toBe(403);
      expect(ports.orderReader.getWithPayments).not.toHaveBeenCalled();
      expect(provider.introspection.paymentDetails).not.toHaveBeenCalled();
      await app.close();
    });

    // The order carries no store of its own: the manage-permission gate above guards the route, and
    // ownership within the order is the PAYMENT's own stamped `storeKey`.
    test('an order is served under its payments own store key', async () => {
      givenOrder(order());
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      await app.close();
    });

    test('a client-sent X-Store-Key is IGNORED — the order decides which store is served', async () => {
      const app = await buildApp();

      const res = await get(app, { ...manageHeaders, 'X-Store-Key': 'store-of-another-merchant' });

      expect(res.statusCode).toBe(200);
      expect(ports.configResolver.resolve).toHaveBeenCalledWith(ORDER_STORE_KEY);
      expect(ports.configResolver.resolve).not.toHaveBeenCalledWith('store-of-another-merchant');
      await app.close();
    });
  });

  describe('the panel payload', () => {
    test('a card payment serializes every panel field', async () => {
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({
        payments: [
          {
            id: 'pay-1',
            providerPaymentId: 'wl-1',
            merchantReference: 'WL-0001',
            inReview: true,
            paymentMethod: 'VISA',
            amountPlanned: { centAmount: 1500, currencyCode: 'EUR' },
            fractionDigits: 2,
            capturableAmount: { centAmount: 500, currencyCode: 'EUR' },
            refundableAmount: { centAmount: 600, currencyCode: 'EUR' },
            details: {
              rawStatus: 'CAPTURED',
              orderId: 'ct-pay-1',
              amounts: {
                total: { centAmount: 1500, currencyCode: 'EUR' },
                charged: { centAmount: 1500, currencyCode: 'EUR' },
              },
              operations: [
                {
                  id: 'cap-1',
                  type: 'charge',
                  date: '2026-07-10T10:00:00.000Z',
                  outcome: 'success',
                  amount: { centAmount: 1500, currencyCode: 'EUR' },
                },
              ],
            },
          },
        ],
      });
      await app.close();
    });

    /**
     * The panel formats and submits minor-unit integers, so the exponent has to reach it: `fast-json-stringify`
     * writes only the leaves the schema declares, so this asserts the CONTRACT carries the figure and not
     * merely that the view computed it. A three-digit currency proves it is read off `amountPlanned` rather
     * than assumed, since neither a constant 2 nor a CLDR lookup yields 3.
     */
    test('serializes the minor-unit exponent commercetools states on the payment', async () => {
      givenOrder(
        order({
          payments: [
            ownedPayment({
              amountPlanned: { centAmount: 1500, currencyCode: 'KWD', type: 'centPrecision', fractionDigits: 3 },
            }),
          ],
        }),
      );
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      expect(res.json().payments[0].fractionDigits).toBe(3);
      await app.close();
    });

    test('a provider that reports only a status serializes a bare details object', async () => {
      provider.introspection.paymentDetails = jest
        .fn<typeof provider.introspection.paymentDetails>()
        .mockResolvedValue({ displayStatus: 'CAPTURED', operations: [] });
      const app = await buildApp();

      const res = await get(app);

      expect(res.json().payments[0].details).toStrictEqual({ rawStatus: 'CAPTURED', operations: [] });
      await app.close();
    });

    test('a payment the provider reports no order reference or book for OMITS those keys — never empty shells', async () => {
      provider.introspection.paymentDetails = jest
        .fn<typeof provider.introspection.paymentDetails>()
        .mockResolvedValue({
          displayStatus: 'PENDING_CAPTURE',
          operations: [],
        });
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      const { details } = res.json().payments[0];
      expect(details).toStrictEqual({
        rawStatus: 'PENDING_CAPTURE',
        operations: [],
      });
      expect(Object.keys(details)).toEqual(expect.not.arrayContaining(['orderId', 'amounts']));
      await app.close();
    });

    /**
     * An operation's raw status envelope is a reconciliation input, not a display value: the wire schema does
     * not declare it, so the serializer strips it even though the domain contract carries it on every
     * operation the fake reports.
     */
    test("an operation's raw status envelope never reaches the wire", async () => {
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      const [operation] = res.json().payments[0].details.operations;
      expect(operation).toStrictEqual({
        id: 'cap-1',
        type: 'charge',
        date: '2026-07-10T10:00:00.000Z',
        outcome: 'success',
        amount: { centAmount: 1500, currencyCode: 'EUR' },
      });
      // The envelope's own field, which the payment's DECLARED display `rawStatus` string does not carry: a
      // `"status"` anywhere in the body could only have come from an operation's envelope.
      expect(res.body).not.toContain('"status"');
      await app.close();
    });

    test('a payment whose vendor read failed carries the unavailable marker + reason; the rest of the body is intact', async () => {
      provider.introspection.paymentDetails = jest
        .fn<typeof provider.introspection.paymentDetails>()
        .mockRejectedValue(new Error('vendor unreachable'));
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      const payment = res.json().payments[0];
      expect(payment.details).toStrictEqual({ unavailable: true, reason: expect.any(String) });
      // The commercetools-sourced figures are intact: only the provider read failed.
      expect(payment.capturableAmount).toEqual({ centAmount: 500, currencyCode: 'EUR' });
      expect(payment.refundableAmount).toEqual({ centAmount: 600, currencyCode: 'EUR' });
      expect(payment.inReview).toBe(true);
      await app.close();
    });

    /**
     * The promise is "unavailable + REASON", so the reason must be the provider's OWN typed message —
     * the outage the panel is supposed to explain. What the vendor wrapped it in (its error body, the
     * transport request that carried a credential, a stack) is not the operator's business and must not
     * reach the wire.
     */
    test('a typed provider failure surfaces its safe reason; the vendor body behind it never reaches the wire', async () => {
      const vendorFailure = PspError.fromErrorResponse(402, {
        errorId: 'err-77',
        privateKey: 'sk_live_SUPERSECRET',
        errors: [
          { errorCode: '30051001', message: 'Not enough funds', httpStatusCode: 402, cardNumber: '4111111111111111' },
        ],
      });
      provider.introspection.paymentDetails = jest
        .fn<typeof provider.introspection.paymentDetails>()
        .mockRejectedValue(vendorFailure);
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      expect(res.json().payments[0].details).toStrictEqual({
        unavailable: true,
        reason: 'Not enough funds',
      });
      expect(res.body).not.toContain('sk_live_SUPERSECRET');
      expect(res.body).not.toContain('4111111111111111');
      expect(res.body).not.toContain('PspError');
      await app.close();
    });

    test('an order with no connector-owned payment renders an empty list', async () => {
      givenOrder(
        order({
          payments: [ownedPayment({ paymentMethodInfo: { paymentInterface: 'other-psp' }, custom: { fields: {} } })],
        }),
      );
      const app = await buildApp();

      const res = await get(app);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ payments: [] });
      await app.close();
    });
  });

  // Acceptance 7: no unmasked card number leaves the processor. The details projection copies only the
  // leaves the wire declares, and the schema strips the rest — a rogue/regressed provider that hands the
  // core a PAN in an undeclared field still cannot serialize it. The threshold is 12 digits — the
  // shortest PAN a scheme issues (Maestro) — not 13.
  test('no run of 12+ digits reaches the wire, even when the provider leaks a PAN in an undeclared field', async () => {
    provider.introspection.paymentDetails = jest.fn<typeof provider.introspection.paymentDetails>().mockResolvedValue({
      displayStatus: 'CAPTURED',
      operations: [],
      card: { cardNumber: '4111111111111111' },
    } as never);
    const app = await buildApp();

    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/\d{12,}/);
    expect(res.body).not.toContain('4111111111111111');
    expect(res.json().payments[0].details).toStrictEqual({ rawStatus: 'CAPTURED', operations: [] });
    await app.close();
  });

  // With the card-bearing detail groups removed, the remaining leak surface is a DECLARED string leaf:
  // a vendor body that carries a PAN inside the payment state, the order reference or a leg kind would
  // be copied verbatim by the wire projection. The projection therefore scrubs every free display
  // string (all but the last 4 of a 12+-digit carrier survive as '*'), because the schema cannot:
  // fast-json-stringify 6.4.0 IGNORES `maxLength` (measured — an over-long string serializes whole),
  // so the DTO's 256-char caps are declared bounds, not enforcement, and this scrub is the control.
  test('a PAN in a DECLARED display leaf (displayStatus, orderId, operation type/id) is masked on the wire', async () => {
    provider.introspection.paymentDetails = jest.fn<typeof provider.introspection.paymentDetails>().mockResolvedValue({
      displayStatus: '4111111111111111',
      orderId: '4111 1111 1111 1111',
      operations: [{ id: '4111111111111111', type: '5500 0000 0000 0004', rawStatus: { state: 'CAPTURED' } }],
    });
    const app = await buildApp();

    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/\d{12,}/);
    const { details } = res.json().payments[0];
    expect(details.rawStatus).toBe('************1111');
    expect(details.orderId).toBe('**** **** **** 1111');
    expect(details.operations[0].id).toBe('************1111');
    expect(details.operations[0].type).toBe('**** **** **** 0004');
    await app.close();
  });

  // The omit-empty-groups invariant must hold in the wire projection itself, not only in the provider
  // mapper upstream of it: a domain `amounts` book whose every figure is absent is a legal contract
  // value, and sending it as `{}` would make "the provider reports none" indistinguishable from an
  // empty group.
  test('an amounts book with no surviving figure is OMITTED on the wire, never sent as {}', async () => {
    provider.introspection.paymentDetails = jest.fn<typeof provider.introspection.paymentDetails>().mockResolvedValue({
      displayStatus: 'CAPTURED',
      amounts: {},
      operations: [],
    });
    const app = await buildApp();

    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.json().payments[0].details).toStrictEqual({ rawStatus: 'CAPTURED', operations: [] });
    await app.close();
  });

  test('call budget: ONE commercetools order read and ONE vendor call per connector payment', async () => {
    const app = await buildApp();

    await get(app);

    expect(ports.orderReader.getWithPayments).toHaveBeenCalledTimes(1);
    expect(ports.orderReader.getWithPayments).toHaveBeenCalledWith('order-1');
    expect(provider.introspection.paymentDetails).toHaveBeenCalledTimes(1);
    expect(ports.paymentStore.get).not.toHaveBeenCalled();
    await app.close();
  });
});
