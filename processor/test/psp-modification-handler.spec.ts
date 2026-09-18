import { describe, expect, it, jest } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { storeConfig } from './support/store-config';
import { PspError } from '../src/providers/psp';
import { PspModificationHandler } from '../src/providers/psp/modifications/modification.handler';
import type { PspClient } from '../src/providers/psp/client';
import { mapProviderStatus } from '../src/providers/psp/status';

const cfg = storeConfig();

/** The operation reference the core mints and hands the provider for ONE modification. */
const OPERATION_REFERENCE = 'op-3f2a9c1b7d40-1';

/**
 * A fake Unzer client whose modification methods return the given resource shape — the seam the
 * handler drives. The real client's transport is exercised in `psp-client.spec.ts`; here the handler's
 * OWN job is under test: the right vendor method with the right amount (minor→decimal at the client
 * boundary) and the acknowledgement status the core state machine reads.
 */
function fakeClient(
  over: Partial<Record<'capture' | 'cancelAuthorization' | 'refund', unknown>> = {},
): Pick<PspClient, 'payments'> {
  return {
    payments: {
      capture: jest.fn<PspClient['payments']['capture']>().mockResolvedValue({ id: 'cap-1' }),
      // A PERFORMED void, as Unzer answers one: `isSuccess` is what makes it a settlement rather than an
      // acknowledgement, so the default fixture carries it (see the verdict cases below).
      cancelAuthorization: jest
        .fn<PspClient['payments']['cancelAuthorization']>()
        .mockResolvedValue({ id: 'cnl-1', isSuccess: true }),
      refund: jest.fn<PspClient['payments']['refund']>().mockResolvedValue({ id: 'ref-1' }),
      ...over,
    },
  } as unknown as Pick<PspClient, 'payments'>;
}

describe('PspModificationHandler — capture', () => {
  it('captures the authorization via the client and acknowledges with CAPTURE_REQUESTED', async () => {
    const client = fakeClient();
    const result = await new PspModificationHandler(client).capture(cfg, {
      providerPaymentId: 's-pay-1',
      amount: 1000,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    // Asymmetry: capture carries a bare cent amount and IGNORES currency (fixed by the authorization).
    expect(client.payments.capture).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sandbox' }), {
      paymentId: 's-pay-1',
      amountCents: 1000,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });
    expect(result.providerOperationId).toBe('cap-1');
    // A 200 that states NO verdict is an acknowledgement; the definitive CAPTURED arrives on the webhook.
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CAPTURE_REQUESTED);
  });

  // The capture Unzer PERFORMED. Reading it as an acknowledgement leaves `Charge:Pending` keyed on the
  // vendor operation id, which reconciliation cannot advance (it admits only legs still under our minted
  // name) — so money the vendor really took shows as unsettled until a webhook lands, the panel's
  // `refundableAmount` (Σ `Charge:Success`) stays 0, and every action button on the card goes dark.
  it('settles a capture the vendor states as PERFORMED (isSuccess) as CAPTURED', async () => {
    const client = fakeClient({
      capture: jest.fn<PspClient['payments']['capture']>().mockResolvedValue({ id: 's-chg-1', isSuccess: true }),
    });

    const result = await new PspModificationHandler(client).capture(cfg, {
      providerPaymentId: 's-pay-1',
      amount: 1000,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(result.providerOperationId).toBe('s-chg-1');
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CAPTURED);
  });

  // The fail-closed direction: an ACCEPTED capture is not a performed one. Only an explicit `isSuccess`
  // settles, so a vendor still processing the capture keeps the acknowledgement its webhook will land.
  it('does not settle a capture the vendor states as PENDING', async () => {
    const client = fakeClient({
      capture: jest.fn<PspClient['payments']['capture']>().mockResolvedValue({ id: 's-chg-2', isPending: true }),
    });

    const result = await new PspModificationHandler(client).capture(cfg, {
      providerPaymentId: 's-pay-1',
      amount: 1000,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CAPTURE_REQUESTED);
  });

  it('surfaces a vendor capture refusal (isError) as a mappable FAILED rawStatus', async () => {
    const client = fakeClient({
      capture: jest.fn<PspClient['payments']['capture']>().mockResolvedValue({ id: 'cap-2', isError: true }),
    });
    const result = await new PspModificationHandler(client).capture(cfg, {
      providerPaymentId: 's-pay-1',
      amount: 1000,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.FAILED);
  });

  it('surfaces a non-2xx vendor charge as a typed PspError, never a raw body', async () => {
    const client = fakeClient({
      capture: jest
        .fn<PspClient['payments']['capture']>()
        .mockRejectedValue(new PspError('PSP API error: declined', 400)),
    });

    const err = await new PspModificationHandler(client)
      .capture(cfg, {
        providerPaymentId: 's-pay-1',
        amount: 1000,
        fractionDigits: 2,
        operationReference: OPERATION_REFERENCE,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PspError);
    expect((err as PspError).statusCode).toBe(400);
  });
});

describe('PspModificationHandler — cancel', () => {
  it('reverses the authorization via the client (no amount of its own) and maps CANCELLED', async () => {
    const client = fakeClient();
    const result = await new PspModificationHandler(client).cancel(cfg, {
      providerPaymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    // No amount: the connector only ever voids the authorization in full (see {@link CancelRequest}).
    expect(client.payments.cancelAuthorization).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sandbox' }), {
      paymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });
    expect(result.providerOperationId).toBe('cnl-1');
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CANCELLED);
  });

  // A void Unzer has ACCEPTED but not yet performed answers `isPending` on a 200. Reading that as
  // CANCELLED records `CancelAuthorization:Success` for money the vendor still holds — and the settling
  // webhook leg, whose interpretation was corrected for exactly this case, then reads CANCEL_REQUESTED and
  // records nothing, so the premature success is what the merchant is left with.
  it('maps a PENDING cancel answer to CANCEL_REQUESTED, not a settled CANCELLED', async () => {
    const client = fakeClient({
      cancelAuthorization: jest
        .fn<PspClient['payments']['cancelAuthorization']>()
        .mockResolvedValue({ id: 'cnl-3', isPending: true }),
    });

    const result = await new PspModificationHandler(client).cancel(cfg, {
      providerPaymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CANCEL_REQUESTED);
  });

  // A 200 that states NO verdict is not a settlement. Reading the absence as success is the one direction
  // that cannot be walked back: the money still sits at Unzer while commercetools says it was released.
  // Capture and refund already treat every non-error answer as an acknowledgement; an unstated cancel takes
  // the same fail-closed reading, and its own settling webhook lands it.
  it('does not settle a void the vendor stated no verdict for', async () => {
    const client = fakeClient({
      cancelAuthorization: jest.fn<PspClient['payments']['cancelAuthorization']>().mockResolvedValue({ id: 'cnl-4' }),
    });

    const result = await new PspModificationHandler(client).cancel(cfg, {
      providerPaymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.CANCEL_REQUESTED);
  });

  it('surfaces a vendor cancel refusal (isError) as a mappable FAILED rawStatus', async () => {
    const client = fakeClient({
      cancelAuthorization: jest
        .fn<PspClient['payments']['cancelAuthorization']>()
        .mockResolvedValue({ id: 'cnl-2', isError: true }),
    });
    const result = await new PspModificationHandler(client).cancel(cfg, {
      providerPaymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.FAILED);
  });
});

describe('PspModificationHandler — refund', () => {
  it('refunds a partial amount via the client and acknowledges with REFUND_REQUESTED', async () => {
    const client = fakeClient();
    const result = await new PspModificationHandler(client).refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: { centAmount: 500, currencyCode: 'EUR' },
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(client.payments.refund).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sandbox' }), {
      paymentId: 's-pay-1',
      amountCents: 500,
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });
    expect(result.providerOperationId).toBe('ref-1');
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.REFUND_REQUESTED);
  });

  // The same rule as the capture above, for the same reason: a refund the vendor PERFORMED must reach
  // commercetools as settled, or the panel reports money as still refundable and the next intent sends it
  // again — `refundableAmount` subtracts every refund in flight, but the operator sees "Refunded 0.00".
  it('settles a refund the vendor states as PERFORMED (isSuccess) as REFUNDED', async () => {
    const client = fakeClient({
      refund: jest.fn<PspClient['payments']['refund']>().mockResolvedValue({ id: 's-cnl-1', isSuccess: true }),
    });

    const result = await new PspModificationHandler(client).refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: { centAmount: 500, currencyCode: 'EUR' },
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(result.providerOperationId).toBe('s-cnl-1');
    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.REFUNDED);
  });

  it('does not settle a refund the vendor states as PENDING', async () => {
    const client = fakeClient({
      refund: jest.fn<PspClient['payments']['refund']>().mockResolvedValue({ id: 's-cnl-2', isPending: true }),
    });

    const result = await new PspModificationHandler(client).refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: { centAmount: 500, currencyCode: 'EUR' },
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.REFUND_REQUESTED);
  });

  it('surfaces a vendor refund refusal (isError) as a mappable FAILED rawStatus', async () => {
    const client = fakeClient({
      refund: jest.fn<PspClient['payments']['refund']>().mockResolvedValue({ id: 'ref-2', isError: true }),
    });
    const result = await new PspModificationHandler(client).refund(cfg, {
      providerPaymentId: 's-pay-1',
      amount: { centAmount: 500, currencyCode: 'EUR' },
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    expect(mapProviderStatus(result.rawStatus)).toBe(PaymentState.FAILED);
  });

  it('omits the amount for a full refund (Unzer refunds the whole charge)', async () => {
    const client = fakeClient();
    await new PspModificationHandler(client).refund(cfg, {
      providerPaymentId: 's-pay-1',
      fractionDigits: 2,
      operationReference: OPERATION_REFERENCE,
    });

    const input = (client.payments.refund as jest.Mock).mock.calls[0]![1];
    expect(input).toEqual({ paymentId: 's-pay-1', fractionDigits: 2, operationReference: OPERATION_REFERENCE });
  });

  it('surfaces a vendor refund refusal as a typed PspError 400, never a raw body', async () => {
    const client = fakeClient({
      refund: jest.fn<PspClient['payments']['refund']>().mockRejectedValue(new PspError('PSP API error: refused', 400)),
    });

    const err = await new PspModificationHandler(client)
      .refund(cfg, { providerPaymentId: 's-pay-1', fractionDigits: 2, operationReference: OPERATION_REFERENCE })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PspError);
    expect((err as PspError).statusCode).toBe(400);
  });
});
