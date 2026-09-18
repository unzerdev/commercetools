/**
 * The Merchant Center intent orchestration's ARITY invariant (`applyMerchantIntent`).
 *
 * These specs drive the orchestration DIRECTLY rather than through the route, on purpose: the route's
 * `maxItems: 1` is defence in depth, not the guard. The amount guard reads ONE payment snapshot and
 * judges ONE action against it, so the rejection of a batch has to hold in the orchestration itself —
 * and keep holding if someone later relaxes the DTO.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Errorx } from '@commercetools/connect-payments-sdk';
import { type ModificationRequest, PaymentState } from '../src/domain';
import { applyMerchantIntent } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { captureAction, partlySettledPayment, PAYMENT_STORE_KEY, refundAction } from './support/payment-fixtures';

describe('orchestration/applyMerchantIntent — exactly one action per intent', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(partlySettledPayment());
  });

  const run = (data: ModificationRequest) =>
    applyMerchantIntent({ env, paymentId: 'pay-1', data }, { ports, provider });

  /** The error the call rejected with — failing loudly if it resolved instead, so a pass is never vacuous. */
  async function rejection(data: ModificationRequest): Promise<Errorx> {
    try {
      await run(data);
    } catch (error) {
      return error as Errorx;
    }
    throw new Error('Expected applyMerchantIntent to reject, but it resolved.');
  }

  const noProviderCall = (): void => {
    expect(provider.modifications.capture).not.toHaveBeenCalled();
    expect(provider.modifications.refund).not.toHaveBeenCalled();
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
    // Nor is anything written ahead of it: a rejected intent leaves no reserved leg holding the headroom.
    expect(ports.paymentStore.reserve).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  };

  test('a guarded action followed by an unguarded one → 400; no money moves', async () => {
    const error = await rejection({ actions: [captureAction(500), refundAction(999999)] });

    expect(error.httpErrorStatus).toBe(400);
    noProviderCall();
  });

  test('two captures that each fit the headroom but together overdraw it → 400', async () => {
    const error = await rejection({ actions: [captureAction(300), captureAction(300)] });

    expect(error.httpErrorStatus).toBe(400);
    noProviderCall();
  });

  test('no action at all → 400, not a crash', async () => {
    const error = await rejection({ actions: [] });

    expect(error.httpErrorStatus).toBe(400);
    noProviderCall();
  });

  test('a rejected batch costs ZERO commercetools reads — the arity check precedes the payment load', async () => {
    await rejection({ actions: [captureAction(500), refundAction(999999)] });

    expect(ports.paymentStore.get).not.toHaveBeenCalled();
  });

  test('exactly one action still runs — the provider is called on the payment’s own store', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const result = await run({ actions: [captureAction(500)] });

    expect(result.outcome).toBe('approved');
    expect(provider.modifications.capture).toHaveBeenCalledWith(expect.anything(), {
      providerPaymentId: 'vendor-pay-1',
      amount: 500,
      fractionDigits: 2,
      operationReference: expect.any(String),
    });
    expect(ports.configResolver.resolve).toHaveBeenCalledWith(PAYMENT_STORE_KEY);
    expect(ports.paymentStore.get).toHaveBeenCalledTimes(1);
  });
});
