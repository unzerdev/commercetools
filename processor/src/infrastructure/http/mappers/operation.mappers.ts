import type {
  ModificationResultView,
  Money,
  OrderPaymentsView,
  OrderPaymentView,
  PaymentDetailsAmounts,
  ProviderOperation,
  SupportedComponents,
} from '../../../domain';
import { scrubDisplayString } from '../../../domain';
import type { OrderPaymentsResponseSchemaDTO } from '../dtos/mc-view/order-payments.dto';
import type { PaymentIntentResponseSchemaDTO } from '../dtos/shared/payment-intents.dto';
import type { SupportedPaymentComponentsSchemaDTO } from '../dtos/mc/payment-components.dto';

type OrderPaymentWire = OrderPaymentsResponseSchemaDTO['payments'][number];
type PaymentDetailsWire = OrderPaymentWire['details'];
type PaymentDetailsAvailableWire = Extract<PaymentDetailsWire, { rawStatus: string }>;
type OperationWire = PaymentDetailsAvailableWire['operations'][number];
type AmountWire = NonNullable<OperationWire['amount']>;

/** The open dropin `type` narrowed onto the wire enum. */
export function toSupportedComponentsWire(components: SupportedComponents): SupportedPaymentComponentsSchemaDTO {
  type WireDropinType = SupportedPaymentComponentsSchemaDTO['dropins'][number]['type'];
  return {
    dropins: components.dropins.map((dropin) => ({ type: dropin.type as WireDropinType })),
    components: components.components.map((component) => ({
      type: component.type,
      ...(component.subtypes ? { subtypes: component.subtypes } : {}),
    })),
    express: components.express.map((express) => ({ type: express.type })),
  };
}

/** The modification outcome without the internal `pspReference`. */
export function toPaymentIntentWire(result: ModificationResultView): PaymentIntentResponseSchemaDTO {
  return { outcome: result.outcome };
}

const toAmountWire = (amount: Money): AmountWire => ({
  centAmount: amount.centAmount,
  currencyCode: amount.currencyCode,
});

const toAmountsWire = (amounts: PaymentDetailsAmounts): PaymentDetailsAvailableWire['amounts'] => {
  const wire = {
    ...(amounts.total ? { total: toAmountWire(amounts.total) } : {}),
    ...(amounts.authorized ? { authorized: toAmountWire(amounts.authorized) } : {}),
    ...(amounts.charged ? { charged: toAmountWire(amounts.charged) } : {}),
    ...(amounts.cancelled ? { cancelled: toAmountWire(amounts.cancelled) } : {}),
    ...(amounts.refunded ? { refunded: toAmountWire(amounts.refunded) } : {}),
  };
  return Object.keys(wire).length > 0 ? wire : undefined;
};

/** `date` is exempt from the PAN scrub: an ISO timestamp carries 14 digits and the panel parses it as a Date. */
const toOperationWire = (operation: ProviderOperation): OperationWire => ({
  ...(operation.id ? { id: scrubDisplayString(operation.id) } : {}),
  ...(operation.type ? { type: scrubDisplayString(operation.type) } : {}),
  ...(operation.date ? { date: operation.date } : {}),
  ...(operation.outcome ? { outcome: operation.outcome } : {}),
  ...(operation.amount ? { amount: toAmountWire(operation.amount) } : {}),
});

/** The provider's details copied leaf by leaf, free display strings PAN-scrubbed; an absent group is omitted. */
function toPaymentDetailsWire(details: OrderPaymentView['details']): PaymentDetailsWire {
  if ('unavailable' in details) {
    return { unavailable: true, reason: details.reason };
  }
  const amounts = details.amounts ? toAmountsWire(details.amounts) : undefined;
  return {
    rawStatus: scrubDisplayString(details.displayStatus),
    ...(details.orderId ? { orderId: scrubDisplayString(details.orderId) } : {}),
    ...(amounts ? { amounts } : {}),
    operations: details.operations.map(toOperationWire),
  };
}

/** The panel view onto its wire DTO; only `details` crosses a provider boundary and is rebuilt field by field. */
export function toOrderPaymentsWire(view: OrderPaymentsView): OrderPaymentsResponseSchemaDTO {
  return {
    payments: view.payments.map((payment: OrderPaymentView) => ({
      ...payment,
      details: toPaymentDetailsWire(payment.details),
    })),
  };
}
