/**
 * `commercetools/payments.repository` - the raw-client CT Payment operations the connect-payments-sdk does
 * not expose: the `setCustomField` review-flag MERGE (never a `setCustomType`
 * replace, so sibling vendor fields survive) with version-CAS, the store-scoped reconciliation
 * lookup by the `merchantReference` + `storeKey` custom fields with a PARAMETERIZED predicate, and the
 * write-ahead reservation trio (`reserve` / `settle` / `release`) the money path spends its headroom
 * through.
 *
 * Mocks the raw apiRoot `payments()` builder chain used by the repository:
 *   client.payments().withId({ID}).get().execute()                       // read version / the leg
 *   client.payments().withId({ID}).post({ body }).execute()              // update actions
 *   client.payments().get({ queryArgs }).execute()                       // merchantReference query
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PaymentVersionConflict, ReservedLegMissing } from '../src/domain';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import {
  findPaymentByMerchantReference,
  releaseTransaction,
  reserveTransaction,
  setPaymentReviewFlag,
  settleTransaction,
} from '../src/infrastructure/commercetools/payments.repository';

interface Captured {
  getExecute: jest.Mock<() => Promise<unknown>>;
  postBody?: {
    version: number;
    actions: {
      action: string;
      name?: string;
      value?: unknown;
      transaction?: Record<string, unknown>;
      transactionId?: string;
      state?: string;
      interactionId?: string;
    }[];
  };
  postExecute: jest.Mock<() => Promise<unknown>>;
  queryArgs?: { where: string; 'var.ref'?: string; 'var.store'?: string; limit?: number };
  queryExecute: jest.Mock<() => Promise<unknown>>;
}

function mockPayments(): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>(),
    queryExecute: jest.fn<() => Promise<unknown>>(),
  };
  const withId = () => ({
    get: () => ({ execute: captured.getExecute }),
    post: (args: { body: Captured['postBody'] }) => {
      captured.postBody = args.body;
      return { execute: captured.postExecute };
    },
  });
  const builder = {
    withId,
    get: (args: { queryArgs: Captured['queryArgs'] }) => {
      captured.queryArgs = args.queryArgs;
      return { execute: captured.queryExecute };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'payments').mockReturnValue(builder as never);
  return captured;
}

describe('commercetools/payments.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('setPaymentReviewFlag', () => {
    it('merges the inReview field via setCustomField at the read version — never setCustomType', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue({ body: { version: 7 } });
      captured.postExecute.mockResolvedValue({ body: { version: 8 } });

      await setPaymentReviewFlag('pay-1');

      expect(captured.postBody?.version).toBe(7);
      expect(captured.postBody?.actions).toEqual([{ action: 'setCustomField', name: 'inReview', value: true }]);
      // The whole point: a single-field merge, not a whole-custom replace.
      expect(captured.postBody?.actions.some((a) => a.action === 'setCustomType')).toBe(false);
    });

    it('retries on a 409 ConcurrentModification, re-reading the version', async () => {
      const captured = mockPayments();
      captured.getExecute
        .mockResolvedValueOnce({ body: { version: 7 } })
        .mockResolvedValueOnce({ body: { version: 9 } });
      captured.postExecute
        .mockRejectedValueOnce({ statusCode: 409, body: { errors: [{ code: 'ConcurrentModification' }] } })
        .mockResolvedValueOnce({ body: { version: 10 } });

      await setPaymentReviewFlag('pay-1');

      expect(captured.getExecute).toHaveBeenCalledTimes(2);
      expect(captured.postExecute).toHaveBeenCalledTimes(2);
      // The retry re-read the freshest version, not the stale 7.
      expect(captured.postBody?.version).toBe(9);
    });

    it('rethrows a non-conflict error without retrying', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue({ body: { version: 7 } });
      captured.postExecute.mockRejectedValue({ statusCode: 400 });

      await expect(setPaymentReviewFlag('pay-1')).rejects.toEqual({ statusCode: 400 });
      expect(captured.postExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('findPaymentByMerchantReference', () => {
    it('queries merchantReference AND storeKey with a PARAMETERIZED predicate (store-scoped)', async () => {
      const captured = mockPayments();
      const payment = { id: 'pay-1' };
      captured.queryExecute.mockResolvedValue({ body: { results: [payment] } });

      await expect(findPaymentByMerchantReference('ref-42', 'store-1')).resolves.toBe(payment);

      // Both terms parameterized — a crafted reference cannot widen the query past its own store.
      expect(captured.queryArgs?.where).toBe('custom(fields(merchantReference = :ref and storeKey = :store))');
      expect(captured.queryArgs?.['var.ref']).toBe('ref-42');
      expect(captured.queryArgs?.['var.store']).toBe('store-1');
      // limit 2 surfaces the (near-impossible) same-store collision.
      expect(captured.queryArgs?.limit).toBe(2);
    });

    it('returns undefined when no payment matches in the store', async () => {
      const captured = mockPayments();
      captured.queryExecute.mockResolvedValue({ body: { results: [] } });

      await expect(findPaymentByMerchantReference('ref-missing', 'store-1')).resolves.toBeUndefined();
    });
  });

  const RESERVATION = {
    type: 'Refund' as const,
    amount: { centAmount: 500, currencyCode: 'EUR' },
    interactionId: 'intent-1',
  };

  /** The handle the reserved Refund leg is found by: its TYPE and the id the reservation minted. */
  const RESERVED_LEG = { type: 'Refund' as const, interactionId: 'intent-1' };

  /** A CT Payment carrying one reserved (Pending) Refund leg keyed on the caller's own intent id. */
  const reservedPayment = (state = 'Pending', interactionId = 'intent-1') => ({
    body: {
      id: 'pay-1',
      version: 9,
      transactions: [{ id: 'tx-1', type: 'Refund', state, interactionId, amount: RESERVATION.amount }],
    },
  });

  const CONFLICT = { statusCode: 409, body: { errors: [{ code: 'ConcurrentModification' }] } };

  describe('reserveTransaction', () => {
    it('adds a Pending leg with the caller`s interactionId at the caller`s OWN version', async () => {
      const captured = mockPayments();
      captured.postExecute.mockResolvedValue({ body: { id: 'pay-1', version: 8 } });

      await reserveTransaction({ id: 'pay-1', version: 7, transaction: RESERVATION });

      // The version is the one the CALLER read and sized its headroom against — never a re-read.
      expect(captured.getExecute).not.toHaveBeenCalled();
      expect(captured.postBody?.version).toBe(7);
      expect(captured.postBody?.actions).toHaveLength(1);
      const [action] = captured.postBody!.actions;
      expect(action.action).toBe('addTransaction');
      expect(action.transaction).toMatchObject({
        type: 'Refund',
        state: 'Pending',
        interactionId: 'intent-1',
        amount: { centAmount: 500, currencyCode: 'EUR' },
      });
    });

    it('FAILS with PaymentVersionConflict on a stale version — no retry, nothing written', async () => {
      const captured = mockPayments();
      captured.postExecute.mockRejectedValue(CONFLICT);

      await expect(reserveTransaction({ id: 'pay-1', version: 7, transaction: RESERVATION })).rejects.toBeInstanceOf(
        PaymentVersionConflict,
      );

      // A retry would re-read a version whose headroom nobody guarded — the loser of the race must lose.
      expect(captured.postExecute).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-conflict error unchanged', async () => {
      const captured = mockPayments();
      captured.postExecute.mockRejectedValue({ statusCode: 400 });

      await expect(reserveTransaction({ id: 'pay-1', version: 7, transaction: RESERVATION })).rejects.toEqual({
        statusCode: 400,
      });
      expect(captured.postExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('settleTransaction', () => {
    it('stamps the vendor operation id onto the reserved leg and moves its state', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(reservedPayment());
      captured.postExecute.mockResolvedValue({ body: { version: 10 } });

      await settleTransaction('pay-1', RESERVED_LEG, { state: 'Success', providerOperationId: 'op-77' });

      expect(captured.postBody?.version).toBe(9);
      expect(captured.postBody?.actions).toEqual([
        { action: 'changeTransactionState', transactionId: 'tx-1', state: 'Success' },
        { action: 'changeTransactionInteractionId', transactionId: 'tx-1', interactionId: 'op-77' },
      ]);
    });

    // A settle IS a re-key, so `TransactionSettlement` requires the vendor's operation id and an operation the
    // vendor never named never gets here (its leg is left standing — `modify-payment::closeReservedLeg`). The
    // re-key is posted only when it would CHANGE something: a leg already carrying that id — reconciliation
    // stamped it `Pending` on an earlier load, and the vendor now reports it settled — is only advanced.
    it('re-keys only when the leg is not already carrying the vendor id', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(reservedPayment('Pending', 'op-77'));
      captured.postExecute.mockResolvedValue({ body: { version: 10 } });

      await settleTransaction(
        'pay-1',
        { type: 'Refund', interactionId: 'op-77' },
        { state: 'Success', providerOperationId: 'op-77' },
      );

      expect(captured.postBody?.actions).toEqual([
        { action: 'changeTransactionState', transactionId: 'tx-1', state: 'Success' },
      ]);
    });

    it('writes nothing when the leg already carries the outcome (a redelivered settle)', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(reservedPayment('Success', 'op-77'));

      await settleTransaction(
        'pay-1',
        { type: 'Refund', interactionId: 'op-77' },
        { state: 'Success', providerOperationId: 'op-77' },
      );

      expect(captured.postExecute).not.toHaveBeenCalled();
    });

    it('retries a 409: the reservation is already written, only its outcome is being recorded', async () => {
      const captured = mockPayments();
      captured.getExecute
        .mockResolvedValueOnce(reservedPayment())
        .mockResolvedValueOnce({ body: { ...reservedPayment().body, version: 11 } });
      captured.postExecute.mockRejectedValueOnce(CONFLICT).mockResolvedValueOnce({ body: { version: 12 } });

      await settleTransaction('pay-1', RESERVED_LEG, { state: 'Success', providerOperationId: 'op-77' });

      expect(captured.getExecute).toHaveBeenCalledTimes(2);
      expect(captured.postBody?.version).toBe(11);
    });

    // TYPED, not a bare Error: the same throw means different things to its two callers. To the money path
    // it is a stranded vendor outcome (a fault); to a panel load whose leg a CONCURRENT load already re-keyed
    // it is just a lost race — and only the type can tell them apart.
    it('throws ReservedLegMissing when the reserved leg is gone — a stranded outcome must never be silent', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue({ body: { id: 'pay-1', version: 9, transactions: [] } });

      const settlement = { state: 'Success' as const, providerOperationId: 'op-77' };
      await expect(settleTransaction('pay-1', RESERVED_LEG, settlement)).rejects.toBeInstanceOf(ReservedLegMissing);
      await expect(settleTransaction('pay-1', RESERVED_LEG, settlement)).rejects.toThrow(/intent-1/);
      expect(captured.postExecute).not.toHaveBeenCalled();
    });
  });

  /**
   * The leg is selected by TYPE + `interactionId`, exactly as the SDK's consolidation matches one — never by
   * the id alone. A cancel's vendor operation id IS the vendor PAYMENT id, which the Authorization leg
   * already carries (`create-payment.ts` stamps it there), so an id-only lookup can legitimately find a leg
   * of ANOTHER type and write the vendor's answer onto it: the settled cancel would land on the
   * authorization, and the payment's own record of the authorized money would be overwritten.
   */
  describe('the reserved leg is selected by type + interactionId', () => {
    /** A cancelled payment as the connector really writes it: both legs carry the vendor PAYMENT id. */
    const cancelledPayment = () => ({
      body: {
        id: 'pay-1',
        version: 9,
        transactions: [
          { id: 'tx-auth', type: 'Authorization', state: 'Success', interactionId: 'vendor-pay-1' },
          { id: 'tx-cancel', type: 'CancelAuthorization', state: 'Pending', interactionId: 'vendor-pay-1' },
        ],
      },
    });

    it('settles the leg of the reserved TYPE, not another type’s leg carrying the same id', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(cancelledPayment());
      captured.postExecute.mockResolvedValue({ body: { version: 10 } });

      // The cancel's own operation id IS the vendor payment id — what the handler surfaces, and what the leg
      // was reserved under once the reservation was re-keyed. The Authorization leg carries that id too, so
      // this settle also crosses the twin guard: another TYPE is no twin, and nothing is released.
      await settleTransaction(
        'pay-1',
        { type: 'CancelAuthorization', interactionId: 'vendor-pay-1' },
        { state: 'Success', providerOperationId: 'vendor-pay-1' },
      );

      expect(captured.postBody?.actions).toEqual([
        { action: 'changeTransactionState', transactionId: 'tx-cancel', state: 'Success' },
      ]);
    });

    it('a leg of another type carrying the id is NOT the reserved leg: ReservedLegMissing, nothing written', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue({
        body: {
          id: 'pay-1',
          version: 9,
          transactions: [{ id: 'tx-auth', type: 'Authorization', state: 'Success', interactionId: 'vendor-pay-1' }],
        },
      });

      await expect(
        settleTransaction(
          'pay-1',
          { type: 'Charge', interactionId: 'vendor-pay-1' },
          { state: 'Success', providerOperationId: 'vendor-pay-1' },
        ),
      ).rejects.toBeInstanceOf(ReservedLegMissing);
      expect(captured.postExecute).not.toHaveBeenCalled();
    });

    it('releases the leg of the reserved TYPE, leaving another type’s leg with the same id untouched', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(cancelledPayment());
      captured.postExecute.mockResolvedValue({ body: { version: 10 } });

      await releaseTransaction('pay-1', { type: 'CancelAuthorization', interactionId: 'vendor-pay-1' });

      expect(captured.postBody?.actions).toEqual([
        { action: 'changeTransactionState', transactionId: 'tx-cancel', state: 'Failure' },
      ]);
    });
  });

  describe('releaseTransaction', () => {
    it('moves the reserved leg to Failure so the headroom comes back', async () => {
      const captured = mockPayments();
      captured.getExecute.mockResolvedValue(reservedPayment());
      captured.postExecute.mockResolvedValue({ body: { version: 10 } });

      await releaseTransaction('pay-1', RESERVED_LEG);

      expect(captured.postBody?.actions).toEqual([
        { action: 'changeTransactionState', transactionId: 'tx-1', state: 'Failure' },
      ]);
    });
  });
});
