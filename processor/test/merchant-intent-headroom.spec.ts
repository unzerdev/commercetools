/**
 * The Merchant Center intent route's money guards, driven end-to-end against a payment store that REPLAYS
 * the SDK's transaction consolidation — so each request's write is what the next request reads.
 *
 * the vendor answers a capture/refund with `CAPTURE_REQUESTED`/`REFUND_REQUESTED` and settles it later by
 * webhook. The operation is real money, already accepted by the vendor, and it must therefore be visible
 * to the very next request: a headroom that could not see it would wave the SAME refund through twice.
 * These specs pin the whole loop — the accepted operation lands as a PENDING leg, the pending leg consumes
 * the headroom, the duplicate is rejected 400 before the vendor is touched, and the settling webhook
 * CONSOLIDATES onto that leg rather than adding a second one (which would be a worse bug than the one
 * being fixed).
 *
 * They also pin the two preconditions the panel's buttons must never be the only enforcement of: capture
 * requires a successful authorization, and cancel requires something still left to cancel.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { PaymentState } from '../src/domain';
import type { ProviderModule } from '../src/application/handlers';
import { handleWebhook } from '../src/application/orchestration';
import { paymentAmounts } from '../src/application/orchestration';
import type { StoreAuthorizationDeps } from '../src/infrastructure/http/authorization/store-authorization';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { statefulPaymentStore, type StatefulPaymentStore } from './support/in-memory-payment-store';
import { buildOperationsApp, manageHeaders } from './support/operations-app';
import {
  cancelIntent,
  captureIntent,
  eur,
  leg,
  ownedPayment,
  PAYMENT_STORE_KEY,
  refundIntent,
  reverseIntent,
} from './support/payment-fixtures';

const AUTHORIZED = leg('Authorization', 'Success', 1000);
const CAPTURED = leg('Charge', 'Success', 1000);

describe('POST /operations/payments/:id/intents — the headroom sees in-flight money', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ProviderModule;
  let store: StatefulPaymentStore;
  let storeExists: jest.MockedFunction<StoreAuthorizationDeps['storeChecker']['storeExists']>;
  const env = makeFakeEnv();

  /** Install a payment whose transactions actually accumulate as the orchestration writes them. */
  const givenPayment = (transactions: unknown[]): void => {
    store = statefulPaymentStore(ownedPayment(transactions));
    ports.paymentStore = store.port;
  };

  /** The vendor accepted the operation and will settle it by webhook: an outcome still in flight, not a refusal. */
  const vendorAccepts = (state: PaymentState): void => {
    provider.mapProviderStatus = jest.fn<ProviderModule['mapProviderStatus']>().mockReturnValue(state);
  };

  const buildApp = (): Promise<FastifyInstance> => buildOperationsApp({ ports, provider, storeExists });

  const post = async (url: string, payload: object): Promise<LightMyRequestResponse> => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url, payload, headers: manageHeaders });
    await app.close();
    return res;
  };

  const intent = (payload: object) => post('/operations/payments/pay-1/intents', payload);

  const legsOfType = (type: string): any[] => store.current().transactions.filter((t: any) => t.type === type);

  const noVendorCall = (): void => {
    expect(provider.modifications.capture).not.toHaveBeenCalled();
    expect(provider.modifications.refund).not.toHaveBeenCalled();
    expect(provider.modifications.cancel).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    storeExists = jest.fn<StoreAuthorizationDeps['storeChecker']['storeExists']>().mockResolvedValue(true);
    givenPayment([AUTHORIZED, CAPTURED]);
  });

  describe('a refund the vendor has accepted cannot be sent twice', () => {
    beforeEach(() => {
      vendorAccepts(PaymentState.REFUND_REQUESTED);
    });

    test('REFUND_REQUESTED lands a Refund:Pending leg stamped with the vendor operation id', async () => {
      const res = await intent(refundIntent(1000));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'received' });
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ type: 'Refund', state: 'Pending', amount: eur(1000), interactionId: 'ref-1' }),
      ]);
    });

    test('the SECOND identical refund is rejected 400 and never reaches the vendor', async () => {
      expect((await intent(refundIntent(1000))).statusCode).toBe(200);

      const second = await intent(refundIntent(1000));

      expect(second.statusCode).toBe(400);
      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
    });

    test('the in-flight refund holds the refund headroom shut until it settles', async () => {
      await intent(refundIntent(1000));

      const amounts = paymentAmounts(store.current());
      expect(amounts.refundable).toStrictEqual(eur(0));
    });

    test('the settling webhook flips the SAME leg to Success — it never adds a second Refund', async () => {
      await intent(refundIntent(1000));
      // The leg the webhook must land ON. Asserted here so this spec cannot pass by the webhook simply
      // appending a Success leg to a payment that carries no pending one — the very bug it guards against.
      expect(legsOfType('Refund')).toStrictEqual([expect.objectContaining({ state: 'Pending' })]);

      provider.webhook.parse = jest.fn<ProviderModule['webhook']['parse']>().mockResolvedValue({
        kind: 'payment.refunded',
        paymentRef: 'WL-0001',
        providerPaymentId: 'vendor-pay-1',
        operationId: 'ref-1',
        amount: eur(1000),
        rawStatus: { state: 'REFUNDED' },
      });
      vendorAccepts(PaymentState.REFUNDED);

      const result = await handleWebhook(
        { env, storeKey: PAYMENT_STORE_KEY, rawBody: Buffer.from('{}'), token: 'tok-1' },
        { ports, provider },
      );

      expect(result.outcome).toBe('processed');
      expect(legsOfType('Refund')).toStrictEqual([
        expect.objectContaining({ state: 'Success', amount: eur(1000), interactionId: 'ref-1' }),
      ]);
    });
  });

  describe('a partial capture the vendor has accepted cannot be sent twice', () => {
    beforeEach(() => {
      givenPayment([AUTHORIZED]);
      vendorAccepts(PaymentState.CAPTURE_REQUESTED);
    });

    test('CAPTURE_REQUESTED lands a Charge:Pending leg for the requested amount', async () => {
      const res = await intent(captureIntent(600));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ outcome: 'received' });
      expect(legsOfType('Charge')).toStrictEqual([
        expect.objectContaining({ type: 'Charge', state: 'Pending', amount: eur(600), interactionId: 'cap-1' }),
      ]);
    });

    test('the SECOND identical partial capture overdraws what is left and is rejected 400', async () => {
      expect((await intent(captureIntent(600))).statusCode).toBe(200);

      const second = await intent(captureIntent(600));

      expect(second.statusCode).toBe(400);
      expect(provider.modifications.capture).toHaveBeenCalledTimes(1);
    });

    test('the capture headroom the in-flight capture left over is still spendable', async () => {
      await intent(captureIntent(600));

      expect((await intent(captureIntent(400))).statusCode).toBe(200);
      expect(provider.modifications.capture).toHaveBeenCalledTimes(2);
    });

    // A capture the vendor accepted but has not settled is not money in yet, so none of it may be given
    // back: the refund headroom counts settled captures only.
    test('the in-flight capture is not yet refundable money', async () => {
      await intent(captureIntent(600));

      expect(paymentAmounts(store.current()).refundable).toStrictEqual(eur(0));
    });
  });

  describe('capture requires a successful authorization (the button is not the guard)', () => {
    test('a DECLINED payment (only Authorization:Failure) → 400, and the vendor is never called', async () => {
      givenPayment([leg('Authorization', 'Failure', 1000)]);

      const res = await intent(captureIntent(1000));

      expect(res.statusCode).toBe(400);
      noVendorCall();
    });

    test('a payment with NO transactions at all → 400, and the vendor is never called', async () => {
      givenPayment([]);

      const res = await intent(captureIntent(1000));

      expect(res.statusCode).toBe(400);
      noVendorCall();
    });

    test('an auto-capture / SALE payment is not broken: it offers no capture, but refunds fine', async () => {
      givenPayment([CAPTURED]);
      vendorAccepts(PaymentState.REFUNDED);

      expect((await intent(captureIntent(1000))).statusCode).toBe(400);
      expect(provider.modifications.capture).not.toHaveBeenCalled();

      expect((await intent(refundIntent(1000))).statusCode).toBe(200);
      expect(provider.modifications.refund).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel is guarded by the capture headroom (it voids the whole authorization)', () => {
    test('cancelling a FULLY CAPTURED payment → 400, and the vendor is never called', async () => {
      givenPayment([AUTHORIZED, CAPTURED]);

      const res = await intent(cancelIntent);

      expect(res.statusCode).toBe(400);
      noVendorCall();
    });

    test('cancelling an authorized-but-uncaptured payment → 200, and the vendor IS called', async () => {
      givenPayment([AUTHORIZED]);
      vendorAccepts(PaymentState.CANCELLED);

      const res = await intent(cancelIntent);

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.cancel).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        merchantOrderId: 'pay-1',
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
    });

    test('a cancel that already voided the authorization cannot be sent twice', async () => {
      givenPayment([AUTHORIZED]);
      vendorAccepts(PaymentState.CANCELLED);

      expect((await intent(cancelIntent)).statusCode).toBe(200);

      const second = await intent(cancelIntent);

      expect(second.statusCode).toBe(400);
      expect(provider.modifications.cancel).toHaveBeenCalledTimes(1);
    });

    // The ledger the headroom is computed FROM must record what the vendor actually voided, not what the
    // cart once planned: after a partial capture the vendor can only void the balance, and a leg claiming
    // the full planned amount would over-consume the very headroom the next guard reads.
    test('a cancel after a partial capture records the amount actually voided, not the planned amount', async () => {
      givenPayment([AUTHORIZED, leg('Charge', 'Success', 300)]);
      vendorAccepts(PaymentState.CANCELLED);

      expect((await intent(cancelIntent)).statusCode).toBe(200);

      expect(legsOfType('CancelAuthorization')).toStrictEqual([
        expect.objectContaining({ type: 'CancelAuthorization', amount: eur(700) }),
      ]);
    });
  });

  /**
   * The provider answers about the OPERATION — a performed refund is `REFUNDED` whether it gave back the
   * whole capture or two of twelve — so partiality is the core's to derive, from the headroom the payment
   * carried minus what this operation takes. It never was derived on this path: only the webhook
   * downgraded, so a refund taken from the Merchant Center wrote `refunded` on a payment the vendor showed
   * as partly refunded, and the money still held by the merchant vanished from the payment's own summary.
   */
  describe('partiality is derived from the headroom the operation leaves behind', () => {
    const writtenState = (): string | undefined => {
      const calls = (ports.paymentStore.setStatus as jest.Mock).mock.calls as unknown[][];
      return (calls.at(-1)?.[1] as { stateKey?: string } | undefined)?.stateKey;
    };

    test('a refund that leaves refundable money writes the partial state', async () => {
      givenPayment([AUTHORIZED, CAPTURED]);
      vendorAccepts(PaymentState.REFUNDED);

      expect((await intent(refundIntent(200))).statusCode).toBe(200);

      expect(writtenState()).toBe('partially-refunded');
    });

    test('a refund that gives back the last of it writes the full state', async () => {
      givenPayment([AUTHORIZED, CAPTURED]);
      vendorAccepts(PaymentState.REFUNDED);

      expect((await intent(refundIntent(1000))).statusCode).toBe(200);

      expect(writtenState()).toBe('refunded');
    });

    test('a cancel that leaves capturable money writes the partial state', async () => {
      givenPayment([AUTHORIZED]);
      vendorAccepts(PaymentState.CANCELLED);

      const res = await intent({ ...cancelIntent, actions: [{ action: 'cancelPayment', amount: eur(200) }] });

      expect(res.statusCode).toBe(200);
      expect(writtenState()).toBe('partially-cancelled');
    });
  });

  // A cancel may name an amount and void PART of what is still authorized, leaving the rest capturable.
  // It draws on the same headroom a full cancel does — what is still uncaptured — so an amount beyond it
  // would release money that has already been taken.
  describe('a partial cancel', () => {
    test('voids the named amount and leaves the rest capturable', async () => {
      givenPayment([AUTHORIZED, leg('Charge', 'Success', 300)]);
      vendorAccepts(PaymentState.CANCELLED);

      const res = await intent({ ...cancelIntent, actions: [{ action: 'cancelPayment', amount: eur(200) }] });

      expect(res.statusCode).toBe(200);
      // The vendor is told the figure, so it voids 200 of the 700 still authorized rather than all of it.
      expect(provider.modifications.cancel).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        amount: eur(200),
        merchantOrderId: 'pay-1',
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
      // And the CT leg records the same 200, not the 700 a full cancel would have booked.
      expect(legsOfType('CancelAuthorization')).toStrictEqual([
        expect.objectContaining({ type: 'CancelAuthorization', amount: eur(200) }),
      ]);
    });

    test('is refused 400 unsent when the amount exceeds what is still authorized', async () => {
      givenPayment([AUTHORIZED, leg('Charge', 'Success', 300)]);

      const res = await intent({ ...cancelIntent, actions: [{ action: 'cancelPayment', amount: eur(701) }] });

      expect(res.statusCode).toBe(400);
      noVendorCall();
      expect(legsOfType('CancelAuthorization')).toStrictEqual([]);
    });

    test('is refused 400 unsent when the amount is not positive', async () => {
      givenPayment([AUTHORIZED]);

      const res = await intent({ ...cancelIntent, actions: [{ action: 'cancelPayment', amount: eur(0) }] });

      expect(res.statusCode).toBe(400);
      noVendorCall();
    });

    // Omitting the amount still means "void everything left" — the partial path must not change it.
    test('without an amount still voids the whole capture headroom', async () => {
      givenPayment([AUTHORIZED, leg('Charge', 'Success', 300)]);
      vendorAccepts(PaymentState.CANCELLED);

      expect((await intent(cancelIntent)).statusCode).toBe(200);

      expect(provider.modifications.cancel).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ amount: expect.anything() }),
      );
    });
  });

  // `reversePayment` bounds WHETHER there is anything to reverse; it never bounds HOW MUCH. It resolves to
  // a refund of the payment's full planned amount, so on this route it is guarded exactly like the concrete
  // operation it resolves to — refund by the refund headroom, cancel by the capture headroom.
  describe('reversePayment is guarded as the operation it resolves to', () => {
    test('a reverse that resolves to a refund BEYOND what settled is rejected 400, unsent', async () => {
      givenPayment([AUTHORIZED, leg('Charge', 'Success', 300)]);

      const res = await intent(reverseIntent);

      expect(res.statusCode).toBe(400);
      noVendorCall();
      expect(legsOfType('Refund')).toStrictEqual([]);
    });

    test('a reverse that resolves to a refund WITHIN the refundable amount still goes through', async () => {
      givenPayment([AUTHORIZED, CAPTURED]);
      vendorAccepts(PaymentState.REFUNDED);

      const res = await intent(reverseIntent);

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.refund).toHaveBeenCalledWith(expect.anything(), {
        providerPaymentId: 'vendor-pay-1',
        amount: eur(1000),
        fractionDigits: 2,
        operationReference: expect.any(String),
      });
    });

    test('a reverse that resolves to a cancel is bounded by the capture headroom', async () => {
      // An authorization whose capture is already in flight: nothing is left to void, and the resolved
      // cancel must be refused the same way a bare `cancelPayment` would be.
      givenPayment([AUTHORIZED, leg('Charge', 'Pending', 1000)]);

      const res = await intent(reverseIntent);

      expect(res.statusCode).toBe(400);
      noVendorCall();
    });

    test('a reverse that resolves to a cancel with headroom left goes through', async () => {
      givenPayment([AUTHORIZED]);
      vendorAccepts(PaymentState.CANCELLED);

      const res = await intent(reverseIntent);

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.cancel).toHaveBeenCalledTimes(1);
    });
  });

  // The certified Checkout contract (OAuth2) keeps NO amount guard — the MC route's guards must not leak
  // into it. Its SIDE EFFECT does change by design: an accepted operation now lands a pending leg there too.
  describe('the Checkout route stays unguarded', () => {
    test('cancel on a fully captured payment still reaches the vendor', async () => {
      givenPayment([AUTHORIZED, CAPTURED]);
      vendorAccepts(PaymentState.CANCELLED);

      const res = await post('/operations/payment-intents/pay-1', cancelIntent);

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.cancel).toHaveBeenCalledTimes(1);
    });

    test('capture on a payment with no authorization still reaches the vendor', async () => {
      givenPayment([]);
      vendorAccepts(PaymentState.CAPTURED);

      const res = await post('/operations/payment-intents/pay-1', captureIntent(1000));

      expect(res.statusCode).toBe(200);
      expect(provider.modifications.capture).toHaveBeenCalledTimes(1);
    });
  });
});
