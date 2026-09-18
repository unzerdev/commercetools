/**
 * Resolving a STANDING RESERVATION against the provider's own operation list.
 *
 * The money path reserves before it calls the vendor, so an outcome that is never learned (a timeout, a
 * crash between the reserve and the call) leaves a `Pending` leg holding the headroom shut. The panel read
 * already fetches `paymentDetails`, whose `operations` are what the vendor reports it HOLDS — so a leg it
 * reports is settled from that answer, at no extra vendor call.
 *
 * The one thing reconciliation may never do is act on ABSENCE. An operation the vendor does not report is
 * not an operation that did not happen, and every case below that offers an empty operation list pins the
 * same invariant: the leg stays, the headroom stays shut, and nothing is written. A leg wrongly released
 * hands back headroom for money that has already moved — and the operator's next refund sends it again.
 *
 * A standing leg is matched by ONE key, the vendor's own operation id, because that is the only key the
 * payment read offers: Unzer reports a leg as `participantId`/`date`/`type`/`status`/`url`/`amount` and
 * carries no merchant reference on it. A leg still under the name the reservation MINTED is therefore
 * unmatchable, and the cases below assert what it gets instead — an ERROR line naming the leg, so the wedged
 * payment reaches the operator's runbook rather than standing in silence.
 *
 * The writes run against the STATEFUL payment store, which takes the real repository's decisions (it inverts
 * a settle into a release when the webhook already reflected the operation; it throws `ReservedLegMissing`
 * when a concurrent load re-keyed the leg). The panel is then asserted against what that store HOLDS — never
 * against what the reconciler asked for, which is exactly the difference the operator's money hangs on.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { PaymentState, ReservedLegMissing } from '../src/domain';
import type { ProviderOperation } from '../src/domain';
import { mintOperationReference } from '../src/domain';
import { getOrderPayments, type OrchestrationLogger } from '../src/application/orchestration';
import { RECONCILE_MARGIN_MS, reconcileAfterMs } from '../src/application/orchestration';
import type { OrderWithPayments } from '../src/application/ports';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../src/infrastructure/config/config';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { statefulPaymentStore, type StatefulPaymentStore } from './support/in-memory-payment-store';

const CONNECTOR_INTERFACE = 'psp';
const PAYMENT_ID = 'pay-1';
const RESERVED_VERSION = 7;

/** The vendor's own id for the refund it performed — the id a settling webhook keys its leg on. */
const VENDOR_REFUND_ID = 'wl-refund-77';
/** A second refund the same payment holds, under the vendor's own id for it. */
const SECOND_VENDOR_REFUND_ID = 'wl-refund-88';

const money = (centAmount: number): { centAmount: number; currencyCode: string } => ({
  centAmount,
  currencyCode: 'EUR',
});

/**
 * The names the reservation minted on this payment — the real minter, so no format drifts. Each names the
 * leg it reserved, money and all: a name IS the operation, and two operations that differ in what they
 * move are two names.
 */
const REFUND_REFERENCE = mintOperationReference(
  CONNECTOR_INTERFACE,
  PAYMENT_ID,
  RESERVED_VERSION,
  'Refund',
  money(1000),
);
const CHARGE_REFERENCE = mintOperationReference(
  CONNECTOR_INTERFACE,
  PAYMENT_ID,
  RESERVED_VERSION,
  'Charge',
  money(1500),
);

/** The handle a resolution finds a standing leg by: its TYPE and the vendor operation id it is keyed on. */
const VENDOR_REFUND_LEG = { type: 'Refund' as const, interactionId: VENDOR_REFUND_ID };

/** A leg reserved `ms` milliseconds ago. */
const aged = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** Older than any in-flight vendor call could possibly be — see `reconcileAfterMs`. */
const stale = (): string => aged(60 * 60 * 1000);
/** Reserved seconds ago: the vendor call is still running in another request. */
const fresh = (): string => new Date().toISOString();

/** A settled authorization + capture: the ground every refund case below stands on. */
const settledCapture = [
  { id: 'tx-auth', type: 'Authorization', state: 'Success', amount: money(1500), interactionId: 'wl-1' },
  { id: 'tx-charge', type: 'Charge', state: 'Success', amount: money(1000), interactionId: 'wl-cap-1' },
];

/** A fully captured payment: 1500 authorized, 1500 taken — so two refunds may stand against it. */
const settledFullCapture = [
  { id: 'tx-auth', type: 'Authorization', state: 'Success', amount: money(1500), interactionId: 'wl-1' },
  { id: 'tx-charge', type: 'Charge', state: 'Success', amount: money(1500), interactionId: 'wl-cap-1' },
];

/** A standing reservation: a `Pending` leg still keyed on the name we minted before calling the vendor. */
const reservedRefund = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tx-refund',
  type: 'Refund',
  state: 'Pending',
  amount: money(1000),
  interactionId: REFUND_REFERENCE,
  timestamp: stale(),
  ...overrides,
});

/**
 * The standing leg reconciliation CAN match: a `Pending` refund already keyed on the vendor's own operation
 * id, left behind by an answer that was read as an acknowledgement (`modify-payment::closeReservedLeg` on the
 * Merchant Center path, `appendOperationLeg` on the Checkout path).
 */
const vendorKeyedRefund = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tx-refund',
  type: 'Refund',
  state: 'Pending',
  amount: money(1000),
  interactionId: VENDOR_REFUND_ID,
  timestamp: stale(),
  ...overrides,
});

/** A second such leg on the same payment — a 200 refund the vendor also acknowledged without settling. */
const secondVendorKeyedRefund = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tx-refund-2',
  type: 'Refund',
  state: 'Pending',
  amount: money(200),
  interactionId: SECOND_VENDOR_REFUND_ID,
  timestamp: stale(),
  ...overrides,
});

function ownedPayment(transactions: unknown[]): any {
  return fakePayment({
    id: PAYMENT_ID,
    version: 12,
    interfaceId: 'wl-1',
    amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
    paymentMethodInfo: { paymentInterface: CONNECTOR_INTERFACE, method: 'VISA' },
    transactions,
    custom: { fields: { merchantReference: 'WL-0001', storeKey: 'store-a' } },
  });
}

function order(transactions: unknown[]): OrderWithPayments {
  return {
    id: 'order-1',
    payments: [ownedPayment(transactions)],
  };
}

/** One leg, reduced to what a reconciliation can move: its state and the id it is keyed on. */
const legShape = (leg: { id: string; state: string; interactionId?: string }) => ({
  id: leg.id,
  state: leg.state,
  interactionId: leg.interactionId,
});

describe('getOrderPayments — resolving a standing reservation against the vendor operation list', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let store: StatefulPaymentStore;
  let logger: {
    info: jest.Mock<OrchestrationLogger['info']>;
    warn: jest.Mock<OrchestrationLogger['warn']>;
    error: jest.Mock<OrchestrationLogger['error']>;
  };
  let env: ReturnType<typeof makeFakeEnv>;

  /**
   * The payment as the panel READ it, and the payment commercetools HOLDS.
   *
   * They are the same object in the common case and DELIBERATELY different when something wrote between the
   * two — a settling webhook, a concurrent panel load. Every reconciliation write lands on the held payment,
   * and the panel is judged against it: a view can only be true if it says what commercetools has.
   */
  const given = (read: unknown[], held: unknown[] = read): void => {
    store = statefulPaymentStore(ownedPayment(held));
    ports.paymentStore = store.port;
    ports.orderReader.getWithPayments = jest
      .fn<typeof ports.orderReader.getWithPayments>()
      .mockResolvedValue(order(read));
  };

  /**
   * What the vendor reports it holds against the payment, typed as the CONTRACT rather than as `unknown[]`:
   * a double may then carry only members `psp/mapping.ts::toProviderOperations` can actually emit, and the
   * compiler refuses a shape the system cannot produce.
   */
  const givenVendorOperations = (operations: ProviderOperation[]): void => {
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockResolvedValue({ displayStatus: 'CAPTURED', operations });
  };

  const givenVendorStatusMapsTo = (state: PaymentState): void => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(state);
  };

  const view = () => getOrderPayments({ env, orderId: 'order-1' }, { ports, provider });

  /** The legs commercetools actually holds, after everything this load wrote. */
  const held = () => store.current().transactions.map(legShape);

  /**
   * The amounts of the legs commercetools holds in one type and state — what it records as moved. The panel
   * renders the VENDOR's legs, so money a reconciliation settled is asserted where it is written
   * rather than where the response used to echo it.
   */
  const legAmounts = (type: string, state: string) =>
    store
      .current()
      .transactions.filter((leg: { type: string; state: string }) => leg.type === type && leg.state === state)
      .map((leg: { amount: unknown }) => leg.amount);

  const noCtWrites = (): void => {
    expect(ports.paymentStore.settle).not.toHaveBeenCalled();
    expect(ports.paymentStore.release).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    logger = {
      info: jest.fn<OrchestrationLogger['info']>(),
      warn: jest.fn<OrchestrationLogger['warn']>(),
      error: jest.fn<OrchestrationLogger['error']>(),
    };
    env = makeFakeEnv({ brand: { paymentInterface: CONNECTOR_INTERFACE }, logger });
  });

  test('the vendor DID perform the refund: the leg is advanced to Success and the panel records the money', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, amount: money(1000), rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    const result = await view();

    // Advanced under the id it already carries: the state moves, the key does not.
    expect(ports.paymentStore.settle).toHaveBeenCalledTimes(1);
    expect(ports.paymentStore.settle).toHaveBeenCalledWith(PAYMENT_ID, VENDOR_REFUND_LEG, {
      state: 'Success',
      providerOperationId: VENDOR_REFUND_ID,
    });
    expect(ports.paymentStore.release).not.toHaveBeenCalled();

    // commercetools HOLDS the settled leg, and the refund it records is money the panel no longer offers to
    // refund again.
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Success', interactionId: VENDOR_REFUND_ID });
    expect(legAmounts('Refund', 'Success')).toEqual([money(1000)]);
    expect(result.payments[0].refundableAmount).toEqual(money(0));
  });

  /**
   * Two panel loads at once is ordinary, and a commercetools write that fails is ordinary too. Either way the
   * fault must cost ONE leg — not every other standing leg on the payment, whose money is just as fenced off.
   */
  test('a write that fails for one leg still resolves the other standing leg on the payment', async () => {
    given([...settledFullCapture, vendorKeyedRefund(), secondVendorKeyedRefund()]);
    givenVendorOperations([
      { id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } },
      { id: SECOND_VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } },
    ]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);
    // The first write alone fails; the second runs against the real store, so what it lands is real.
    const storeSettle = ports.paymentStore.settle;
    ports.paymentStore.settle = jest
      .fn<typeof ports.paymentStore.settle>()
      .mockRejectedValueOnce(new Error('commercetools unavailable'))
      .mockImplementation(storeSettle);

    const result = await view();

    expect(ports.paymentStore.settle).toHaveBeenCalledTimes(2);
    // The first leg's failure did not abandon the second: it was resolved and the money it moved is recorded.
    expect(held()).toContainEqual({ id: 'tx-refund-2', state: 'Success', interactionId: SECOND_VENDOR_REFUND_ID });
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: VENDOR_REFUND_ID });
    expect(legAmounts('Refund', 'Success')).toEqual([money(200)]);
    // 1500 captured, 200 given back, 1000 still held by the leg whose write failed — the fail-closed direction.
    expect(result.payments[0].refundableAmount).toEqual(money(300));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  /**
   * A leg a CONCURRENT load already resolved is gone from under the id we knew it by, and the repository says
   * so with {@link ReservedLegMissing}. That load wrote the very outcome this one was about to write, so it is
   * no fault — but the payment MOVED, and the panel has to be built from a fresh read rather than from the
   * stale one this load holds.
   */
  test('a leg a concurrent load already resolved is no fault, and the panel is re-read all the same', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);
    ports.paymentStore.settle = jest
      .fn<typeof ports.paymentStore.settle>()
      .mockRejectedValue(new ReservedLegMissing(PAYMENT_ID, VENDOR_REFUND_ID));

    await view();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(ports.paymentStore.get).toHaveBeenCalledTimes(1);
  });

  /**
   * A leg still under the name the reservation minted can be matched by NOTHING in the operation list. The
   * vendor's payment read reports a leg's own resource id and no merchant reference at all
   * (`PaymentGetResponseTransaction`: `participantId`/`date`/`type`/`status`/`url`/`amount`), so no operation
   * the provider can produce carries the minted name back — the leg is wedged for the life of the payment and
   * only the operator's runbook clears it.
   *
   * It is therefore REPORTED, at the level and in the shape the write path uses for the same fault
   * (`modify-payment::leaveLegStanding`): an alert keyed on ERROR must see every leg that holds the headroom
   * shut with no request left alive to report it.
   */
  test('a leg still under the MINTED name is reported at error: no provider read can echo that name back', async () => {
    given([...settledCapture, reservedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    const result = await view();

    noCtWrites();
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: REFUND_REFERENCE });
    expect(result.payments[0].refundableAmount).toEqual(money(0));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('minted'), {
      paymentId: PAYMENT_ID,
      transactionType: 'Refund',
      interactionId: REFUND_REFERENCE,
    });
  });

  test('the vendor holds it but REFUSED it: the leg is released — that money never moved', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'FAILED' } }]);
    givenVendorStatusMapsTo(PaymentState.FAILED);

    const result = await view();

    expect(ports.paymentStore.release).toHaveBeenCalledWith(PAYMENT_ID, VENDOR_REFUND_LEG);
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Failure', interactionId: VENDOR_REFUND_ID });
    expect(result.payments[0].refundableAmount).toEqual(money(1000));
  });

  /** A minted CHARGE leg: the same wedge on the capture side, where it shuts the capture headroom instead. */
  const mintedCapture = (): unknown[] => [
    { id: 'tx-auth', type: 'Authorization', state: 'Success', amount: money(1500), interactionId: 'wl-1' },
    {
      id: 'tx-charge',
      type: 'Charge',
      state: 'Pending',
      amount: money(1500),
      interactionId: CHARGE_REFERENCE,
      timestamp: stale(),
    },
  ];

  test('a minted capture leg keeps the capture headroom shut and is reported under its own type', async () => {
    given(mintedCapture());
    givenVendorOperations([{ id: 'wl-cap-9', rawStatus: { state: 'CAPTURED' } }]);
    givenVendorStatusMapsTo(PaymentState.CAPTURED);

    const result = await view();

    noCtWrites();
    expect(result.payments[0].capturableAmount).toEqual(money(0));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('minted'), {
      paymentId: PAYMENT_ID,
      transactionType: 'Charge',
      interactionId: CHARGE_REFERENCE,
    });
  });

  /**
   * The same resolution on the CAPTURE side, where a standing leg shuts the capture headroom rather than the
   * refund one: a `Charge:Pending` counts as spent against `capturableAmount` and contributes nothing to
   * `refundableAmount` (Σ `Charge:Success`), so Capture, Refund and Cancel all go dark over money the vendor
   * really took.
   *
   * Both halves of the write seam produce this shape. The Merchant Center path settles its reservation to
   * `Pending` and re-keys it to the vendor id (`modify-payment::closeReservedLeg`); the Checkout path appends
   * the same shape (`appendOperationLeg`). Neither leg carries our minted name any more, so only a settling
   * webhook could otherwise move it — on an account whose webhook cannot reach the processor, never.
   *
   * Matching is by the vendor's own id (`operation.id === leg.interactionId`), and nothing is ever re-keyed
   * here — the leg already carries the only id anything could key it to, so the rule that a leg is only ever
   * keyed on an id the vendor gave holds by construction.
   */
  describe('a capture leg keyed on the vendor operation id', () => {
    /** The vendor's own id for the capture it performed — what the leg is keyed on, and what it is matched by. */
    const VENDOR_CAPTURE_ID = 's-chg-1';

    /** The confirmed shape: 1500 authorized, captured in full, recorded `Pending` under the vendor's id. */
    const vendorKeyedCapture = (overrides: Record<string, unknown> = {}): unknown[] => [
      { id: 'tx-auth', type: 'Authorization', state: 'Success', amount: money(1500), interactionId: 'wl-1' },
      {
        id: 'tx-charge',
        type: 'Charge',
        state: 'Pending',
        amount: money(1500),
        interactionId: VENDOR_CAPTURE_ID,
        timestamp: stale(),
        ...overrides,
      },
    ];

    const givenVendorPerformedTheCapture = (): void => {
      givenVendorOperations([{ id: VENDOR_CAPTURE_ID, rawStatus: { state: 'CAPTURED' } }]);
      givenVendorStatusMapsTo(PaymentState.CAPTURED);
    };

    test('the vendor reports it PERFORMED: the leg is advanced to Success and the panel offers the refund', async () => {
      given(vendorKeyedCapture());
      givenVendorPerformedTheCapture();

      const result = await view();

      // Settled under the id it already carries: the state moves, the key does not.
      expect(ports.paymentStore.settle).toHaveBeenCalledTimes(1);
      expect(ports.paymentStore.settle).toHaveBeenCalledWith(
        PAYMENT_ID,
        { type: 'Charge', interactionId: VENDOR_CAPTURE_ID },
        { state: 'Success', providerOperationId: VENDOR_CAPTURE_ID },
      );
      expect(held()).toContainEqual({ id: 'tx-charge', state: 'Success', interactionId: VENDOR_CAPTURE_ID });

      // What the operator's three buttons read: nothing left to capture, the captured money refundable.
      expect(result.payments[0].capturableAmount).toEqual(money(0));
      expect(result.payments[0].refundableAmount).toEqual(money(1500));
    });

    // No staleness window applies. The window exists to keep this load off a leg whose OWN request may still
    // be inside its vendor call — and a leg carrying the vendor's operation id is proof that that request
    // already had its answer. Waiting would only prolong a wedged payment for no safety at all.
    test('a leg written SECONDS ago is advanced too: no request can still be holding a vendor-keyed leg', async () => {
      given(vendorKeyedCapture({ timestamp: fresh() }));
      givenVendorPerformedTheCapture();

      const result = await view();

      expect(ports.paymentStore.settle).toHaveBeenCalledTimes(1);
      expect(result.payments[0].refundableAmount).toEqual(money(1500));
    });

    // The create leg writes the same shape for a charge the vendor accepted at purchase (a prepayment, a 3DS
    // redirect): a `Charge:Pending` under the vendor's id and NO authorization leg. A settling webhook that never
    // arrived is therefore no dead end - the next panel load reads the vendor's own list and settles it.
    test('the leg the create call opened settles when the vendor reports the charge succeeded', async () => {
      given([
        {
          id: 'tx-charge',
          type: 'Charge',
          state: 'Pending',
          amount: money(1500),
          interactionId: VENDOR_CAPTURE_ID,
          timestamp: fresh(),
        },
      ]);
      givenVendorPerformedTheCapture();

      const result = await view();

      expect(ports.paymentStore.settle).toHaveBeenCalledTimes(1);
      expect(held()).toContainEqual({ id: 'tx-charge', state: 'Success', interactionId: VENDOR_CAPTURE_ID });
      expect(result.payments[0].refundableAmount).toEqual(money(1500));
    });

    test('the vendor reports it REFUSED: the leg is released and the capture headroom comes back', async () => {
      given(vendorKeyedCapture());
      givenVendorOperations([{ id: VENDOR_CAPTURE_ID, rawStatus: { state: 'FAILED' } }]);
      givenVendorStatusMapsTo(PaymentState.FAILED);

      const result = await view();

      expect(ports.paymentStore.release).toHaveBeenCalledWith(PAYMENT_ID, {
        type: 'Charge',
        interactionId: VENDOR_CAPTURE_ID,
      });
      expect(ports.paymentStore.settle).not.toHaveBeenCalled();
      expect(result.payments[0].capturableAmount).toEqual(money(1500));
      expect(legAmounts('Charge', 'Success')).toEqual([]);
    });

    // The invariant this whole module rests on holds for the new branch too: absence decides nothing.
    test('the vendor does NOT report it: the leg stands and the headroom stays shut', async () => {
      given(vendorKeyedCapture());
      givenVendorOperations([]);

      const result = await view();

      noCtWrites();
      expect(result.payments[0].capturableAmount).toEqual(money(0));
      expect(result.payments[0].refundableAmount).toEqual(money(0));
    });

    // Nothing was written, and that is the safe move — but a leg this load could not resolve is a leg holding
    // the headroom shut, so it is not allowed to pass in silence. A later load may still resolve it (the
    // vendor may report the operation next time), which is what keeps it a WARN rather than the ERROR a
    // minted leg gets.
    test('a leg the vendor reports no operation for is told, so it does not hold the headroom in silence', async () => {
      given(vendorKeyedCapture());
      givenVendorOperations([]);

      await view();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reports no operation'), {
        paymentId: PAYMENT_ID,
        transactionType: 'Charge',
        interactionId: VENDOR_CAPTURE_ID,
      });
    });

    // A leg the vendor reports as REFUSED cannot be told from one it never reported unless the operation is
    // matched by the id the leg carries. An operation the vendor reports WITHOUT an id names no leg at all —
    // and the leg it did not name is told exactly like one the vendor never reported.
    test('an operation the vendor reports without an id matches no vendor-keyed leg', async () => {
      given(vendorKeyedCapture());
      givenVendorOperations([{ rawStatus: { state: 'CAPTURED' } }]);
      givenVendorStatusMapsTo(PaymentState.CAPTURED);

      await view();

      noCtWrites();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reports no operation'), {
        paymentId: PAYMENT_ID,
        transactionType: 'Charge',
        interactionId: VENDOR_CAPTURE_ID,
      });
    });
  });

  // A minted leg younger than the window may still be held by its OWN request, which will close it under the
  // name it reserved it by. It is no wedged leg yet, so raising it would send the operator after a payment
  // that is about to resolve itself — the alarm belongs to the leg whose owner is gone.
  test('a FRESH reservation is left to the request that owns it, and is not reported', async () => {
    given([...settledCapture, reservedRefund({ timestamp: fresh() })]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    const result = await view();

    noCtWrites();
    expect(logger.error).not.toHaveBeenCalled();
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: REFUND_REFERENCE });
    expect(result.payments[0].refundableAmount).toEqual(money(0));
  });

  // The report's whole claim is that no live request is left to close the leg, and a leg we cannot age is a
  // leg we cannot make that claim about.
  test('a leg carrying no timestamp cannot be judged stale, so it is not reported either', async () => {
    given([...settledCapture, reservedRefund({ timestamp: undefined })]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    await view();

    noCtWrites();
    expect(logger.error).not.toHaveBeenCalled();
  });

  // A leg keyed on neither our minted name nor an id the vendor reports is keyed on nothing this load can
  // match: the vendor names this operation `wl-refund-99`, while the leg carries the merchant's own
  // back-office reference. Matching it would mean guessing, so nothing is written.
  test('a Pending leg matched by NO reported operation — neither our name nor a reported id — is never touched', async () => {
    given([
      ...settledCapture,
      {
        id: 'tx-boc',
        type: 'Refund',
        state: 'Pending',
        amount: money(500),
        interactionId: '3237690523_1',
        timestamp: stale(),
      },
    ]);
    givenVendorOperations([{ id: 'wl-refund-99', rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    await view();

    noCtWrites();
  });

  // A vendor-keyed leg IS matched (by that id) and IS judged — but the vendor reports the operation still in
  // flight, which is the state the leg already carries. A write here would cost a commercetools round trip to
  // record nothing, so the resolution has to be compared against the leg before anything is posted.
  test('a vendor-keyed Pending leg the vendor still reports as in flight is left exactly as it is', async () => {
    given([
      ...settledCapture,
      {
        id: 'tx-hook',
        type: 'Refund',
        state: 'Pending',
        amount: money(500),
        interactionId: 'wl-refund-99',
        timestamp: stale(),
      },
    ]);
    givenVendorOperations([{ id: 'wl-refund-99', rawStatus: { state: 'REFUND_REQUESTED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUND_REQUESTED);

    await view();

    noCtWrites();
  });

  test('a Pending leg for ANOTHER payment id is not ours either, even in our own minted format', async () => {
    const foreignReference = mintOperationReference(
      CONNECTOR_INTERFACE,
      'pay-2',
      RESERVED_VERSION,
      'Refund',
      money(1000),
    );
    given([...settledCapture, reservedRefund({ interactionId: foreignReference })]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    await view();

    noCtWrites();
    // Not ours, so not reported as ours either: the alarm names only legs this connector minted.
    expect(logger.error).not.toHaveBeenCalled();
  });

  // No reservation ever writes an `Authorization` leg (`operationLeg` only ever mints Charge / Refund /
  // CancelAuthorization), so a Pending Authorization — the IN_REVIEW leg — can only ever be a FALSE
  // positive here, whatever its interactionId looks like.
  test('a Pending Authorization (a payment in review) is never reconciled', async () => {
    const authReference = mintOperationReference(
      CONNECTOR_INTERFACE,
      PAYMENT_ID,
      RESERVED_VERSION,
      'Authorization',
      money(1500),
    );
    given([
      {
        id: 'tx-review',
        type: 'Authorization',
        state: 'Pending',
        amount: money(1500),
        interactionId: authReference,
        timestamp: stale(),
      },
    ]);
    givenVendorOperations([{ id: 'wl-auth-1', rawStatus: { state: 'CAPTURED' } }]);
    givenVendorStatusMapsTo(PaymentState.CAPTURED);

    await view();

    noCtWrites();
  });

  test('details UNAVAILABLE reconciles nothing — no truth, no decision — and the panel still renders', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockRejectedValue(new Error('vendor unreachable'));

    const result = await view();

    noCtWrites();
    expect(result.payments[0].details).toEqual({ unavailable: true, reason: expect.any(String) });
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: VENDOR_REFUND_ID });
    expect(result.payments[0].refundableAmount).toEqual(money(0));
  });

  /**
   * The wedged-leg report may not depend on the vendor read, because the two failures are CORRELATED: a leg is
   * wedged precisely because a vendor call did not answer, and the same unreachable host or rejected keypair
   * fails the next payment read. An alert gated on that read would therefore stay silent for the whole of the
   * incident that creates the wedge — so the report is raised on a load whose details never arrived.
   *
   * The other half of the same claim: nothing is JUDGED against a list we never got. A vendor-keyed leg on the
   * same payment is passed over in silence rather than told as unreported, which is what an empty operation
   * list would have made of it.
   */
  test('a minted leg is reported at error when the vendor read FAILS, and no leg is judged against the list we never got', async () => {
    given([...settledFullCapture, reservedRefund(), secondVendorKeyedRefund()]);
    provider.introspection.paymentDetails = jest
      .fn<typeof provider.introspection.paymentDetails>()
      .mockRejectedValue(new Error('vendor unreachable'));

    const result = await view();

    noCtWrites();
    expect(result.payments[0].details).toEqual({ unavailable: true, reason: expect.any(String) });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('minted'), {
      paymentId: PAYMENT_ID,
      transactionType: 'Refund',
      interactionId: REFUND_REFERENCE,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('a reconciliation write that throws does not fail the panel: the leg simply stays', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);
    ports.paymentStore.settle = jest
      .fn<typeof ports.paymentStore.settle>()
      .mockRejectedValue(new Error('commercetools unavailable'));

    const result = await view();

    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: VENDOR_REFUND_ID });
    // The leg stands, so the headroom it holds stays shut — the fail-closed direction.
    expect(result.payments[0].refundableAmount).toEqual(money(0));
    expect(result.payments[0].details).toMatchObject({ displayStatus: 'CAPTURED' });
    // A commercetools write that failed IS a fault, and reads as one.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // Judging a leg maps the vendor's status through the state machine, which THROWS on a status nobody mapped.
  // That is a fault of ONE operation; the panel — the operator's only view of the money — must survive it.
  test('an operation whose status the state machine cannot map costs that leg only, never the panel', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'WHAT_IS_THIS' } }]);
    givenVendorStatusMapsTo('SOME_STATE_NOBODY_MAPPED' as PaymentState);

    const result = await view();

    noCtWrites();
    expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: VENDOR_REFUND_ID });
    expect(result.payments[0].refundableAmount).toEqual(money(0));
    expect(result.payments[0].details).toMatchObject({ displayStatus: 'CAPTURED' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('call budget: a panel load with nothing to reconcile issues no extra vendor call and no CT read', async () => {
    given(settledCapture);
    givenVendorOperations([{ id: 'wl-cap-1', rawStatus: { state: 'CAPTURED' } }]);

    await view();

    expect(ports.orderReader.getWithPayments).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).toHaveBeenCalledTimes(1);
    expect(provider.introspection.paymentDetails).toHaveBeenCalledTimes(1);
    expect(ports.paymentStore.get).not.toHaveBeenCalled();
    noCtWrites();
  });

  // The cost of telling the truth: a load that RESOLVED something re-reads the payment it changed, so the
  // panel renders commercetools' own answer rather than the reconciler's expectation of it. One extra CT
  // read, on the rare load that reconciles — and never an extra VENDOR call: the operation list rides the
  // panel read that was happening anyway.
  test('resolving a leg costs ONE commercetools re-read and NO extra vendor call', async () => {
    given([...settledCapture, vendorKeyedRefund()]);
    givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
    givenVendorStatusMapsTo(PaymentState.REFUNDED);

    await view();

    expect(ports.paymentStore.settle).toHaveBeenCalledTimes(1);
    expect(provider.introspection.paymentDetails).toHaveBeenCalledTimes(1);
    expect(ports.paymentStore.get).toHaveBeenCalledTimes(1);
  });

  /**
   * The window decides when a MINTED leg has no live owner left, which is when it stops being a leg about to
   * close itself and becomes a wedged one the operator must be told about. How long an owner can still be
   * inside its vendor call is the connector's vendor-call bound (`StoreConfig.requestTimeoutMs`), so the
   * window is DERIVED from that bound rather than asserted to exceed it: a fixed window plus a bound that
   * later changes is an invariant nothing enforces, and the change that falsifies it raises an ERROR against
   * every in-flight modification the deployment makes.
   */
  describe('the staleness window is derived from the vendor deadline', () => {
    /** The bound the deployment put on ONE vendor call, as the store config the panel resolves carries it. */
    const givenVendorDeadline = async (requestTimeoutMs: number): Promise<void> => {
      const cfg = await ports.configResolver.resolve('store-a');
      ports.configResolver.resolve = jest
        .fn<typeof ports.configResolver.resolve>()
        .mockResolvedValue({ ...cfg, requestTimeoutMs });
    };

    const vendorReportsTheRefund = (): void => {
      givenVendorOperations([{ id: VENDOR_REFUND_ID, rawStatus: { state: 'REFUNDED' } }]);
      givenVendorStatusMapsTo(PaymentState.REFUNDED);
    };

    /** The leg named in the report, or `undefined` when this load raised none. */
    const reported = () => logger.error.mock.calls.map(([, context]) => context)[0];

    // The property, not an example of it: whatever bound the deployment names, a request cannot still be
    // inside its vendor call once the window has passed — because the window is that bound plus the margin.
    test('the window is ALWAYS strictly above the deadline it is derived from', () => {
      [1, DEFAULT_REQUEST_TIMEOUT_MS, 600_000, 3_600_000].forEach((deadline) => {
        expect(reconcileAfterMs(deadline)).toBeGreaterThan(deadline);
      });
      expect(reconcileAfterMs(DEFAULT_REQUEST_TIMEOUT_MS)).toBe(DEFAULT_REQUEST_TIMEOUT_MS + RECONCILE_MARGIN_MS);
    });

    const LONG_DEADLINE_MS = 600_000;

    // The scenario no FIXED window can survive: a six-minute-old leg whose owner is still inside a ten-minute
    // vendor call. Reporting it would raise an operator alert against a modification that is still running and
    // about to close its own leg.
    test('a LONG deadline widens the window: a leg its owner could still be holding is not reported', async () => {
      await givenVendorDeadline(LONG_DEADLINE_MS);
      given([...settledCapture, reservedRefund({ timestamp: aged(6 * 60 * 1000) })]);
      vendorReportsTheRefund();

      const result = await view();

      noCtWrites();
      expect(logger.error).not.toHaveBeenCalled();
      expect(held()).toContainEqual({ id: 'tx-refund', state: 'Pending', interactionId: REFUND_REFERENCE });
      expect(result.payments[0].refundableAmount).toEqual(money(0));
    });

    test('a LONG deadline reports the leg once the derived window has passed', async () => {
      await givenVendorDeadline(LONG_DEADLINE_MS);
      given([...settledCapture, reservedRefund({ timestamp: aged(reconcileAfterMs(LONG_DEADLINE_MS) + 1_000) })]);
      vendorReportsTheRefund();

      await view();

      expect(reported()).toEqual({
        paymentId: PAYMENT_ID,
        transactionType: 'Refund',
        interactionId: REFUND_REFERENCE,
      });
    });

    test('the DEFAULT deadline reports once its own window has passed', async () => {
      given([
        ...settledCapture,
        reservedRefund({ timestamp: aged(reconcileAfterMs(DEFAULT_REQUEST_TIMEOUT_MS) + 1_000) }),
      ]);
      vendorReportsTheRefund();

      await view();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('the DEFAULT deadline leaves a leg younger than its window unreported', async () => {
      given([
        ...settledCapture,
        reservedRefund({ timestamp: aged(reconcileAfterMs(DEFAULT_REQUEST_TIMEOUT_MS) - 30_000) }),
      ]);
      vendorReportsTheRefund();

      await view();

      noCtWrites();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
