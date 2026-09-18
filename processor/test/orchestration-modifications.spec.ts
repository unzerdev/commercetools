/**
 * The capture and reverse dispatch plus the state-machine wiring, and the core
 * cancel-vs-refund DECISION behind `reversePayment`, exercised with fake ports + a fake provider.
 *
 * The reverse decision is driven through `modifyPayment` rather than against a dedicated entry point: it
 * is resolved BEFORE the operation is named and sent (an operation whose type is undecided cannot be
 * named), so what matters is which vendor call comes out the other end.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Errorx } from '@commercetools/connect-payments-sdk';
import { PaymentState } from '../src/domain';
import { modifyPayment, type OrchestrationEnv } from '../src/application/orchestration';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

describe('orchestration/modifyPayment', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  let env: OrchestrationEnv;

  const run = (data: any) => modifyPayment({ env, paymentId: 'pay-1', storeKey: 'store-1', data }, { ports, provider });

  const reverse = { actions: [{ action: 'reversePayment' as const }] };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    env = makeFakeEnv();
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
  });

  test('capturePayment: routes through the provider with the interfaceId + bare cent amount and applies CAPTURED → Charge:Success', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const result = await run({
      actions: [{ action: 'capturePayment', amount: { centAmount: 120000, currencyCode: 'GBP' } }],
    });

    expect(provider.modifications.capture).toHaveBeenCalledWith(expect.anything(), {
      providerPaymentId: 'vendor-pay-1',
      amount: 120000,
      fractionDigits: 2,
      operationReference: expect.any(String),
    });
    expect(result.outcome).toBe('approved');
    expect(result.pspReference).toBe('cap-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ type: 'Charge', state: 'Success', interactionId: 'cap-1' }),
      }),
    );
  });

  test('a FAILED capture records a Charge:Failure transaction, not a spurious Authorization:Failure', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.FAILED);

    const result = await run({
      actions: [{ action: 'capturePayment', amount: { centAmount: 5000, currencyCode: 'GBP' } }],
    });

    expect(result.outcome).toBe('rejected');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ type: 'Charge', state: 'Failure' }) }),
    );
  });

  /**
   * A settled modification writes the page's PSP Status Code and Payment state as `applyOperationResult`'s
   * last act. Asserted at the orchestration level because the helper's own spec stays green with
   * the call site deleted, and the fields then read `-` after every capture and refund.
   */
  test('the vendor status code, its text and the payment state are written from the operation answer', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    provider.modifications.capture = jest.fn<typeof provider.modifications.capture>().mockResolvedValue({
      providerOperationId: 'cap-1',
      rawStatus: { state: 'CAPTURED' },
      statusCode: { code: 'COR.000.100.112', text: 'Your payment has been processed.' },
    });

    await run({ actions: [{ action: 'capturePayment', amount: { centAmount: 1500, currencyCode: 'EUR' } }] });

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.000.100.112',
      interfaceText: 'Your payment has been processed.',
      stateKey: 'completed',
    });
  });

  /**
   * `paymentStatus.state` summarises the PAYMENT, and a modification's outcome is not that. A
   * vendor that declines a refund has not undone the €15.00 it charged: the transaction list still shows
   * `Charge:Success`, so the page must keep reading `Completed`. What the operator gets from the refusal is
   * the vendor's own code and text, which name the reason the refund was declined.
   */
  test('a refused refund of a captured payment writes the vendor code, and no payment state', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(
      fakePayment({
        transactions: [
          { type: 'Authorization', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
          { type: 'Charge', state: 'Success', amount: { centAmount: 1500, currencyCode: 'EUR' } },
        ],
      }),
    );
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.FAILED);
    provider.modifications.refund = jest.fn<typeof provider.modifications.refund>().mockResolvedValue({
      providerOperationId: 'ref-1',
      rawStatus: { state: 'FAILED' },
      statusCode: { code: 'COR.100.301.112', text: 'Refund declined by the issuer.' },
    });

    const result = await run({
      actions: [{ action: 'refundPayment', amount: { centAmount: 500, currencyCode: 'EUR' } }],
    });

    expect(result.outcome).toBe('rejected');
    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.100.301.112',
      interfaceText: 'Refund declined by the issuer.',
    });
  });

  test('the vendor is told the core’s name for the operation — its idempotency key', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    await run({ actions: [{ action: 'capturePayment', amount: { centAmount: 5000, currencyCode: 'GBP' } }] });

    const [, request] = jest.mocked(provider.modifications.capture).mock.calls[0];
    expect(request.operationReference).toEqual(expect.any(String));
  });

  /**
   * This route reserves NOTHING, so nothing bumps the payment version between the read and the write: two
   * concurrent captures read the SAME version. The name is the vendor's idempotency key, so if the money it
   * moves is not IN the name, the vendor performs the first capture and replays that answer to the second —
   * which the core then books as the second amount, on the first operation's id.
   */
  describe('the operation’s name at a payment version that nothing bumps', () => {
    const capture = (centAmount: number) =>
      run({ actions: [{ action: 'capturePayment', amount: { centAmount, currencyCode: 'GBP' } }] });

    const namesToldToTheVendor = (): string[] =>
      jest.mocked(provider.modifications.capture).mock.calls.map(([, request]) => request.operationReference);

    beforeEach(() => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    });

    test('two captures of DIFFERENT amounts at the same version are two operations to the vendor', async () => {
      await capture(30000);
      await capture(20000);

      const [first, second] = namesToldToTheVendor();
      expect(first).not.toBe(second);
    });

    test('the SAME capture replayed at the same version is ONE operation to the vendor', async () => {
      await capture(30000);
      await capture(30000);

      const [first, second] = namesToldToTheVendor();
      expect(first).toBe(second);
    });
  });

  test('reversePayment: a captured payment (Charge:Success) reverses via REFUND, for the full planned amount', async () => {
    ports.paymentStore.hasTransactionInState = jest
      .fn<typeof ports.paymentStore.hasTransactionInState>()
      .mockImplementation((args: any) => args.transactionType === 'Charge');
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);

    await run(reverse);

    expect(provider.modifications.refund).toHaveBeenCalledWith(expect.anything(), {
      providerPaymentId: 'vendor-pay-1',
      amount: { centAmount: 1500, currencyCode: 'EUR' },
      fractionDigits: 2,
      operationReference: expect.any(String),
    });
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
  });

  test('reversePayment: an authorized-only payment reverses via CANCEL', async () => {
    ports.paymentStore.hasTransactionInState = jest
      .fn<typeof ports.paymentStore.hasTransactionInState>()
      .mockImplementation((args: any) => args.transactionType === 'Authorization');
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CANCELLED);

    await run(reverse);

    expect(provider.modifications.cancel).toHaveBeenCalledTimes(1);
    expect(provider.modifications.refund).not.toHaveBeenCalled();
  });

  test('reversePayment: nothing to reverse → throws, and no vendor call is made', async () => {
    ports.paymentStore.hasTransactionInState = jest
      .fn<typeof ports.paymentStore.hasTransactionInState>()
      .mockReturnValue(false);

    await expect(run(reverse)).rejects.toBeDefined();

    expect(provider.modifications.refund).not.toHaveBeenCalled();
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
  });

  /**
   * The vendor answered and the money moved; the commercetools write that RECORDS it is what failed. Blaming
   * the provider for it points support at the PSP on the very payment where the distinction decides whether
   * the money is out — and hides the one thing the operator must know: the operation was performed, so it
   * must not be sent again.
   */
  describe('a commercetools write that fails AFTER the vendor performed the operation', () => {
    beforeEach(() => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REFUNDED);
      ports.paymentStore.update = jest
        .fn<typeof ports.paymentStore.update>()
        .mockRejectedValue(new Error('commercetools is unavailable'));
    });

    const refund = () =>
      run({ actions: [{ action: 'refundPayment', amount: { centAmount: 500, currencyCode: 'EUR' } }] });

    test('is reported as a COMMERCETOOLS fault, never as a provider failure', async () => {
      const error: Errorx = await refund().then(
        () => {
          throw new Error('Expected modifyPayment to reject, but it resolved.');
        },
        (e) => e as Errorx,
      );

      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
      expect(error.message).toBe('The payment provider answered, but recording the answer in commercetools failed.');
      expect(error.httpErrorStatus).toBe(500);
      expect(env.logger.error).not.toHaveBeenCalledWith("Provider operation 'refundPayment' failed", expect.anything());
      expect(env.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('commercetools'),
        expect.objectContaining({ paymentId: 'pay-1', error: 'commercetools is unavailable' }),
      );
    });
  });
});
