import type { OrderPaymentsView, OrderPaymentView, ProviderPaymentDetails, StoreConfig } from '../../../domain';
import { PAYMENT_MERCHANT_REFERENCE_FIELD, PAYMENT_REVIEW_FIELD_NAME, readStringField } from '../../../domain';
import type { OrderWithPayments, Payment } from '../../ports';
import { connectorStoreKey, type OrchestrationDeps, paymentAmounts, wrapProviderError } from '../shared';
import type { GetOrderPaymentsCtx } from './order-payments-ctx';
import { reconcileReservations, reportMintedLegs } from './reconcile-reservations';

function toPaymentView(payment: Payment, details: OrderPaymentView['details']): OrderPaymentView {
  const { currencyCode, fractionDigits } = payment.amountPlanned;
  const amounts = paymentAmounts(payment);
  const merchantReference = readStringField(payment.custom?.fields, PAYMENT_MERCHANT_REFERENCE_FIELD);

  return {
    id: payment.id,
    ...(payment.interfaceId ? { providerPaymentId: payment.interfaceId } : {}),
    ...(merchantReference ? { merchantReference } : {}),
    inReview: payment.custom?.fields?.[PAYMENT_REVIEW_FIELD_NAME] === true,
    ...(payment.paymentMethodInfo?.method ? { paymentMethod: payment.paymentMethodInfo.method } : {}),
    amountPlanned: { centAmount: payment.amountPlanned.centAmount, currencyCode },
    fractionDigits,
    capturableAmount: amounts.capturable,
    refundableAmount: amounts.refundable,
    details,
  };
}

interface OwnedPayment {
  payment: Payment;
  cfg: StoreConfig;
}

function byStoreKey(order: OrderWithPayments): Map<string, Payment[]> {
  const groups = new Map<string, Payment[]>();

  order.payments.forEach((payment) => {
    const storeKey = connectorStoreKey(payment);
    if (storeKey === undefined) {
      return;
    }
    const group = groups.get(storeKey);
    if (group === undefined) {
      groups.set(storeKey, [payment]);
    } else {
      group.push(payment);
    }
  });

  return groups;
}

/** The connector's payments on the order, each with the config of the store whose PSP account holds it; one resolve per store. */
async function ownedPayments(order: OrderWithPayments, deps: OrchestrationDeps): Promise<OwnedPayment[]> {
  const groups = await Promise.all(
    [...byStoreKey(order)].map(async ([storeKey, payments]) => {
      const cfg = await deps.ports.configResolver.resolve(storeKey);

      return payments.map((payment) => ({ payment, cfg }));
    }),
  );

  return groups.flat();
}

/**
 * `GET /operations/orders/:orderId/payments`: every connector-owned payment with its headroom and the
 * provider's view of it, standing reservations reconciled from that view first. A failed vendor read costs
 * that payment's details alone.
 */
export async function getOrderPayments(ctx: GetOrderPaymentsCtx, deps: OrchestrationDeps): Promise<OrderPaymentsView> {
  const { provider } = deps;

  const order = await deps.ports.orderReader.getWithPayments(ctx.orderId);
  const ours = await ownedPayments(order, deps);
  if (ours.length === 0) {
    return { payments: [] };
  }

  const payments = await Promise.all(
    ours.map(async ({ payment, cfg }) => {
      if (!payment.interfaceId) {
        return toPaymentView(payment, { unavailable: true, reason: 'The payment carries no provider reference.' });
      }

      reportMintedLegs(payment, cfg.requestTimeoutMs, ctx.env);

      let details: ProviderPaymentDetails;
      try {
        details = await provider.introspection.paymentDetails(cfg, payment.interfaceId);
      } catch (error) {
        const reason = wrapProviderError(error, 'getOrderPayments', provider.key, ctx.env.logger).message;
        return toPaymentView(payment, { unavailable: true, reason });
      }

      const reconciled = await reconcileReservations(payment, details.operations, ctx.env, deps);
      return toPaymentView(reconciled, details);
    }),
  );

  return { payments };
}
