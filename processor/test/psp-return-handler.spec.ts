import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PaymentState, resolveStateEffect } from '../src/domain';
import { statusForReturn } from '../src/application/orchestration';
import { storeConfig } from './support/store-config';
import { PspError } from '../src/providers/psp';
import { PspReturnHandler } from '../src/providers/psp/return/return.handler';
import type { PspClient, UnzerPayment } from '../src/providers/psp/client';
import { mapProviderStatus } from '../src/providers/psp/status';

const cfg = storeConfig();

/**
 * A real Unzer authoritative payment: the coarse `state.name` plus the transaction legs the interpreter
 * reads. `completed` + a succeeded charge leg is a settled capture — what a returning card payment reads.
 */
const capturedPayment: UnzerPayment = {
  id: 'unzer-ret-1',
  state: { name: 'completed' },
  currency: 'EUR',
  transactions: [
    { type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/unzer-ret-1/charges/s-chg-1' },
  ],
};

/** A fake Unzer client whose `getPayment` returns the given authoritative payment shape. */
function fakeClient(payment: UnzerPayment = capturedPayment) {
  return {
    payments: { get: jest.fn<PspClient['payments']['get']>().mockResolvedValue(payment) },
  } as unknown as Pick<PspClient, 'payments'>;
}

describe('PspReturnHandler — readContext', () => {
  const handler = new PspReturnHandler(fakeClient());

  it('maps the stamped Unzer payment id + shopper return URL into a ReturnContext', () => {
    expect(
      handler.readContext({
        pspPaymentId: 'unzer-ret-1',
        pspShopperReturnUrl: 'https://shop.example.test/thanks',
      }),
    ).toEqual({
      shopperReturnUrl: 'https://shop.example.test/thanks',
      providerContext: { pspPaymentId: 'unzer-ret-1' },
    });
  });

  it('omits absent / wrong-typed fields', () => {
    expect(handler.readContext({})).toEqual({ providerContext: {} });
    expect(handler.readContext({ pspPaymentId: 42 })).toEqual({ providerContext: {} });
  });
});

describe('PspReturnHandler — resolve (authoritative getPayment, fail-closed)', () => {
  let client: Pick<PspClient, 'payments'>;
  const calls = () => (client.payments.get as jest.Mock).mock.calls;

  beforeEach(() => {
    client = fakeClient();
  });

  it('reads the authoritative state off the stamped payment id and maps an approved return', async () => {
    client = fakeClient(capturedPayment);
    const result = await new PspReturnHandler(client).resolve(cfg, {
      query: { ctPaymentId: 'pay-1' },
      context: { pspPaymentId: 'unzer-ret-1' },
    });

    // Exactly ONE authoritative read, keyed on the SERVER-STAMPED id (never a query parameter).
    expect(calls()).toHaveLength(1);
    expect(calls()[0]![1]).toBe('unzer-ret-1');
    expect(result.providerPaymentId).toBe('unzer-ret-1');
    // CAPTURED → Charge:Success → the shopper-facing 'approved' status the route 302s with.
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CAPTURED);
    expect(statusForReturn(resolveStateEffect(mapProviderStatus(result.rawStatus)))).toBe('approved');
    expect(result.action).toEqual({ kind: 'none' });
  });

  it('fails CLOSED when no payment id was stamped, before any getPayment', async () => {
    const err = await new PspReturnHandler(client)
      .resolve(cfg, { query: { ctPaymentId: 'pay-1' }, context: {} })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PspError);
    expect((err as PspError).statusCode).toBe(403);
    expect(calls()).toHaveLength(0);
  });

  it('fails CLOSED when the authoritative payment does not match the stamped id (or carries none)', async () => {
    client = fakeClient({ id: '' });
    const err = await new PspReturnHandler(client)
      .resolve(cfg, { query: { ctPaymentId: 'pay-1' }, context: { pspPaymentId: 'unzer-ret-1' } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PspError);
    expect((err as PspError).statusCode).toBe(403);
  });
});
