import type { Payment } from '@commercetools/connect-payments-sdk';
import type {
  PaymentStatusUpdate,
  ReservedLeg,
  ReserveTransactionArgs,
  TransactionSettlement,
} from '../../application/ports';
import type { CtTransactionState } from '../../domain';
import {
  PAYMENT_MERCHANT_REFERENCE_FIELD,
  PAYMENT_REVIEW_FIELD_NAME,
  PAYMENT_STORE_KEY_FIELD,
  PaymentVersionConflict,
  ReservedLegMissing,
} from '../../domain';
import { log } from '../bootstrap/libs/logger';
import { withVersionRetry } from './cas-retry';
import { isConcurrentModification, isNotFound } from './errors';
import { payments } from './payments';

/** Merge the review flag via `setCustomField`; a `setCustomType` would wipe the sibling vendor fields. */
export async function setPaymentReviewFlag(id: string): Promise<void> {
  await withVersionRetry(
    () => payments.get({ id }),
    async (current) => {
      await payments.applyActions({
        id,
        version: current.version,
        actions: [{ action: 'setCustomField', name: PAYMENT_REVIEW_FIELD_NAME, value: true }],
      });
    },
  );
}

/** The vendor code, text and the payment state in one post; `force: false`, the connector's states declare no graph. */
export async function setPaymentStatus(id: string, status: PaymentStatusUpdate): Promise<void> {
  const actions = [
    ...(status.interfaceCode === undefined
      ? []
      : [{ action: 'setStatusInterfaceCode' as const, interfaceCode: status.interfaceCode }]),
    ...(status.interfaceText === undefined
      ? []
      : [{ action: 'setStatusInterfaceText' as const, interfaceText: status.interfaceText }]),
    ...(status.stateKey === undefined
      ? []
      : [
          {
            action: 'transitionState' as const,
            state: { typeId: 'state' as const, key: status.stateKey },
            force: false,
          },
        ]),
  ];
  if (actions.length === 0) {
    return;
  }

  await withVersionRetry(
    () => payments.get({ id }),
    async (current) => {
      await payments.applyActions({ id, version: current.version, actions });
    },
  );
}

/** The reconciliation lookup, parameterized and scoped to `storeKey` when given; a collision is logged and the head taken. */
export async function findPaymentByMerchantReference(
  merchantReference: string,
  storeKey?: string,
): Promise<Payment | undefined> {
  const scoped = storeKey !== undefined;
  const results = await payments.query({
    where: scoped
      ? `custom(fields(${PAYMENT_MERCHANT_REFERENCE_FIELD} = :ref and ${PAYMENT_STORE_KEY_FIELD} = :store))`
      : `custom(fields(${PAYMENT_MERCHANT_REFERENCE_FIELD} = :ref))`,
    vars: { 'var.ref': merchantReference, ...(scoped ? { 'var.store': storeKey } : {}) },
    limit: 2,
  });

  if (results.length > 1) {
    log.warn('Webhook reconciliation: >1 CT Payment shares a merchantReference within a store', {
      storeKey,
      count: results.length,
    });
  }
  return results[0];
}

/** A payment by id, or `undefined` on a 404. */
export async function findPaymentById(id: string): Promise<Payment | undefined> {
  try {
    return await payments.get({ id });
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Reserve the leg under the caller's version; a conflict is a typed refusal, never retried. */
export async function reserveTransaction(args: ReserveTransactionArgs): Promise<void> {
  const { id, version, transaction } = args;
  try {
    await payments.applyActions({
      id,
      version,
      actions: [
        {
          action: 'addTransaction',
          transaction: {
            type: transaction.type,
            amount: transaction.amount,
            interactionId: transaction.interactionId,
            state: 'Pending',
            timestamp: new Date().toISOString(),
          },
        },
      ],
    });
  } catch (error) {
    if (isConcurrentModification(error)) {
      throw new PaymentVersionConflict(id, version);
    }
    throw error;
  }
}

/**
 * Move a reserved leg (found by type + interactionId) to `state`, re-keying it to the vendor operation id.
 * When the webhook already appended a same-type leg under that id, ours is released instead of becoming a twin.
 * A missing leg throws `ReservedLegMissing`.
 */
async function changeReservedLeg(
  paymentId: string,
  reserved: ReservedLeg,
  change: { state: CtTransactionState; providerOperationId?: string },
): Promise<void> {
  await withVersionRetry(
    () => payments.get({ id: paymentId }),
    async (current) => {
      const leg = current.transactions.find(
        (t) => t.type === reserved.type && t.interactionId === reserved.interactionId,
      );
      if (!leg) {
        throw new ReservedLegMissing(paymentId, reserved.interactionId);
      }

      const alreadyReflected =
        change.providerOperationId !== undefined &&
        current.transactions.some(
          (t) => t.id !== leg.id && t.type === leg.type && t.interactionId === change.providerOperationId,
        );
      const target: { state: CtTransactionState; providerOperationId?: string } = alreadyReflected
        ? { state: 'Failure' }
        : change;

      const actions = [
        ...(leg.state === target.state
          ? []
          : [{ action: 'changeTransactionState' as const, transactionId: leg.id, state: target.state }]),
        ...(target.providerOperationId === undefined || leg.interactionId === target.providerOperationId
          ? []
          : [
              {
                action: 'changeTransactionInteractionId' as const,
                transactionId: leg.id,
                interactionId: target.providerOperationId,
              },
            ]),
      ];
      if (actions.length === 0) {
        return;
      }

      await payments.applyActions({ id: paymentId, version: current.version, actions });
    },
  );
}

export function settleTransaction(
  paymentId: string,
  reserved: ReservedLeg,
  settlement: TransactionSettlement,
): Promise<void> {
  return changeReservedLeg(paymentId, reserved, settlement);
}

export function releaseTransaction(paymentId: string, reserved: ReservedLeg): Promise<void> {
  return changeReservedLeg(paymentId, reserved, { state: 'Failure' });
}
