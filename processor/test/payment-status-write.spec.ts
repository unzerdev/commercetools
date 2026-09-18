/**
 * Writing what the Merchant Center's Payment page reads besides the transactions: the vendor's own
 * status code and message, and the payment state.
 *
 * Two units are pinned here. `config/payment.repository::setPaymentStatus` is the RAW write — none of its
 * three actions exists in the SDK's `updatePayment` argument — and `orchestration/helpers::writePaymentStatus`
 * is the decision above it: which state key a lifecycle value reads as, and the rule that a status write must
 * never fail the path that learned the status.
 *
 * Mocks the raw apiRoot `payments()` builder chain, as `payment.repository.spec.ts` does:
 *   client.payments().withId({ID}).get().execute()            // read version
 *   client.payments().withId({ID}).post({ body }).execute()   // the status actions
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { setPaymentStatus } from '../src/infrastructure/commercetools/payments.repository';
import { writePaymentStatus } from '../src/application/orchestration';
import type { OrchestrationLogger } from '../src/application/orchestration';
import { fakePayment, makeFakeEnv, makeFakePorts } from './support/fake-provider-module';

interface Captured {
  postBody?: { version: number; actions: Record<string, unknown>[] };
  postExecute: jest.Mock<() => Promise<unknown>>;
  getExecute: jest.Mock<() => Promise<unknown>>;
}

function mockPayments(version = 9): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: { version } }),
    postExecute: jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: {} }),
  };
  const builder = {
    withId: () => ({
      get: () => ({ execute: captured.getExecute }),
      post: (post: { body: Captured['postBody'] }) => {
        captured.postBody = post.body;
        return { execute: captured.postExecute };
      },
    }),
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'payments').mockReturnValue(builder as never);
  return captured;
}

describe('config/payment.repository::setPaymentStatus — the raw status write', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // All three actions ride ONE post, so a status write costs one read plus one write however much it says.
  it('posts the vendor code, its text and the state transition in one request', async () => {
    const captured = mockPayments();

    await setPaymentStatus('pay-1', {
      interfaceCode: 'COR.000.100.112',
      interfaceText: 'Your payments have been successfully processed.',
      stateKey: 'completed',
    });

    expect(captured.postBody).toEqual({
      version: 9,
      actions: [
        { action: 'setStatusInterfaceCode', interfaceCode: 'COR.000.100.112' },
        { action: 'setStatusInterfaceText', interfaceText: 'Your payments have been successfully processed.' },
        // By KEY, so no caller ever handles a state id. Never forced: the connector's own states declare no
        // transition graph, so a refusal would mean the state being written is somebody else's machine.
        { action: 'transitionState', state: { typeId: 'state', key: 'completed' }, force: false },
      ],
    });
  });

  it('writes only what it was given', async () => {
    const captured = mockPayments();

    await setPaymentStatus('pay-1', { stateKey: 'processing' });

    expect(captured.postBody?.actions).toEqual([
      { action: 'transitionState', state: { typeId: 'state', key: 'processing' }, force: false },
    ]);
  });

  // Nothing to say costs nothing: not even the version read, so a provider whose vendor issues no code and a
  // lifecycle value that keeps its state pay no commercetools call at all.
  it('issues no request when there is nothing to write', async () => {
    const captured = mockPayments();

    await setPaymentStatus('pay-1', {});

    expect(captured.getExecute).not.toHaveBeenCalled();
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  it('re-reads and re-posts when a concurrent write bumped the version', async () => {
    const captured = mockPayments();
    captured.getExecute
      .mockResolvedValueOnce({ body: { version: 9 } })
      .mockResolvedValueOnce({ body: { version: 10 } });
    captured.postExecute
      .mockRejectedValueOnce({ statusCode: 409, body: { errors: [{ code: 'ConcurrentModification' }] } })
      .mockResolvedValueOnce({ body: {} });

    await setPaymentStatus('pay-1', { stateKey: 'completed' });

    expect(captured.postExecute).toHaveBeenCalledTimes(2);
    expect(captured.postBody?.version).toBe(10);
  });
});

describe('orchestration/helpers::writePaymentStatus — the decision above the write', () => {
  const logger = {
    info: jest.fn<OrchestrationLogger['info']>(),
    warn: jest.fn<OrchestrationLogger['warn']>(),
    error: jest.fn<OrchestrationLogger['error']>(),
  };
  const env = makeFakeEnv({ logger });

  /** A payment with no money record of its own — the operation being written about IS the payment. */
  const fresh = () => fakePayment();

  /** A payment charged €15.00 in full: `Authorization:Success` + `Charge:Success`, nothing given back. */
  const captured = () =>
    fakePayment({
      transactions: [
        { type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
        { type: 'Charge', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
      ],
    });

  it('maps the lifecycle state to its state key and carries the vendor code and text through', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(
      fresh(),
      PaymentState.CAPTURED,
      { code: 'COR.000.100.112', text: 'processed' },
      env,
      ports,
    );

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.000.100.112',
      interfaceText: 'processed',
      stateKey: 'completed',
    });
  });

  it('omits the text when the vendor sent a code without one', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(fresh(), PaymentState.FAILED, { code: 'COR.100.301.112' }, env, ports);

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.100.301.112',
      stateKey: 'failed',
    });
  });

  it('writes the state alone when the vendor stated no code', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(fresh(), PaymentState.AUTHORIZED, undefined, env, ports);

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', { stateKey: 'processing' });
  });

  // A chargeback keeps the state it reached (`payment-status.ts`), so with no vendor code there is nothing to
  // write — and the call is skipped rather than made with an empty payload.
  it('writes nothing at all for a chargeback carrying no vendor code', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(fresh(), PaymentState.CHARGEBACK, undefined, env, ports);

    expect(ports.paymentStore.setStatus).not.toHaveBeenCalled();
  });

  /**
   * The field summarises the PAYMENT, so a refusal the vendor answered a MODIFICATION with may not restate
   * it: a declined refund of a payment that took €15.00 leaves `Charge:Success` standing, and the page must
   * keep reading `Completed` beside it. What the operator gets instead is the vendor's own code and text for
   * the refusal — the two fields that name the reason.
   */
  it('a refusal on a settled payment writes the vendor code and text, and no state', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(
      captured(),
      PaymentState.FAILED,
      { code: 'COR.100.301.112', text: 'declined' },
      env,
      ports,
    );

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.100.301.112',
      interfaceText: 'declined',
    });
  });

  // A refund merely REQUESTED has moved no money, so it must not walk a `completed` payment back to
  // `processing` — the requested leg is already visible in the transactions as `Refund:Pending`.
  it('a requested refund on a settled payment writes no state', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(captured(), PaymentState.REFUND_REQUESTED, undefined, env, ports);

    expect(ports.paymentStore.setStatus).not.toHaveBeenCalled();
  });

  /**
   * The reordered delivery, at the seam that feeds the decision. Unzer's subscription is account-wide
   * (`event: 'all'`) and carries no ordering guarantee, so on a 3-D Secure charge — whose authorization leg is
   * written `Pending`, which is why the webhook's duplicate gate lets the authorize event through — the
   * `payment.pending_capture` event can be processed after `payment.captured`. It arrives here as `AUTHORIZED`,
   * and writing its `processing` would report a captured payment as still in flight for good: no later event on
   * a captured payment restates the field. The payment this path already holds is what rules it out.
   */
  it('an authorization learned AFTER the capture writes no state over the captured payment', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(captured(), PaymentState.AUTHORIZED, { code: 'COR.000.100.112' }, env, ports);

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', { interfaceCode: 'COR.000.100.112' });
  });

  // The settled refund itself is a movement of the payment's own money, so it does restate the payment.
  it('a settled refund on a settled payment writes refunded', async () => {
    const ports = makeFakePorts();

    await writePaymentStatus(captured(), PaymentState.REFUNDED, undefined, env, ports);

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', { stateKey: 'refunded' });
  });

  /**
   * The rule the whole write hangs on. It runs LAST on every path that learns a status, after the
   * transactions and the custom fields are already recorded, so a commercetools failure here must not turn a
   * charged payment into an error response — nor a settled webhook into a 5xx the vendor redelivers. The
   * fault is logged and the next event's write states the truth again; the field is not cumulative.
   */
  it('never throws when commercetools refuses the write, and reports the fault', async () => {
    const ports = makeFakePorts();
    ports.paymentStore.setStatus = jest
      .fn<typeof ports.paymentStore.setStatus>()
      .mockRejectedValue(new Error('commercetools unavailable'));

    await expect(writePaymentStatus(fresh(), PaymentState.CAPTURED, undefined, env, ports)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('payment status could not be written'),
      expect.objectContaining({ paymentId: 'pay-1' }),
    );
  });
});
