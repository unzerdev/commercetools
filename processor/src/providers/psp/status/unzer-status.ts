import { type BookingMode, PaymentState, type SettlementKind } from '../../../domain';
import { fractionDigitsForCurrency, fromDecimalAmount, type UnzerPayment, type UnzerTransaction } from '../client';
import { PspError } from '../errors';
import { legKind } from './leg-kind';

const legSucceeded = (leg: UnzerTransaction): boolean => leg.status === 'success';
const legErrored = (leg: UnzerTransaction | undefined): boolean => leg?.status === 'error';

/** Whether the payment holds captured money: a settled charge leg, or a positive cumulative `charged`. */
function isCaptured(payment: UnzerPayment): boolean {
  const charged = fromDecimalAmount(
    payment.amount?.charged,
    payment.currency ?? 'XXX',
    fractionDigitsForCurrency(payment.currency),
  );
  return (
    (payment.transactions ?? []).some((leg) => legKind(leg) === 'charge' && legSucceeded(leg)) ||
    (charged?.centAmount ?? 0) > 0
  );
}

/** The transaction resource a charge/authorize answers with states its verdict in the triple, not in `state`. */
function transactionVerdict(payment: UnzerPayment, bookingMode: BookingMode | undefined): PaymentState | undefined {
  if (payment.isError === true) {
    return PaymentState.FAILED;
  }
  if (payment.isSuccess === true) {
    return bookingMode === 'authorize' ? PaymentState.AUTHORIZED : PaymentState.CAPTURED;
  }
  if (payment.isPending === true) {
    return bookingMode === 'authorize' ? PaymentState.AUTHORIZATION_REQUESTED : PaymentState.CAPTURE_REQUESTED;
  }
  return undefined;
}

/**
 * Interpret an Unzer payment resource into a `PaymentState`. Leg evidence beats the coarse `state.name`,
 * and the two whole-payment facts (review, chargeback) beat leg evidence. Precedence: payment_review,
 * chargeback, a settled cancellation (refund when captured, else void), captured, a settled authorization,
 * an errored leg, an outstanding redirect, the transaction verdict triple when there is no `state`, the
 * coarse name alone; a genuinely uninterpretable payment throws. Partiality is never produced here.
 */
export function unzerPaymentStatus(payment: UnzerPayment, bookingMode?: BookingMode): PaymentState {
  const name = payment.state?.name?.toLowerCase();

  if (name === 'payment_review') {
    return PaymentState.IN_REVIEW;
  }
  if (name === 'chargeback') {
    return PaymentState.CHARGEBACK;
  }

  const legs = payment.transactions ?? [];
  const captured = isCaptured(payment);

  if (legs.some((leg) => (legKind(leg) === 'refund' || legKind(leg) === 'void') && legSucceeded(leg))) {
    return captured ? PaymentState.REFUNDED : PaymentState.CANCELLED;
  }
  if (captured) {
    return PaymentState.CAPTURED;
  }
  if (legs.some((leg) => legKind(leg) === 'authorization' && legSucceeded(leg))) {
    return PaymentState.AUTHORIZED;
  }
  if (legs.some(legErrored)) {
    return PaymentState.FAILED;
  }
  if (payment.redirectUrl) {
    return PaymentState.REDIRECTED;
  }

  if (name === undefined) {
    const verdict = transactionVerdict(payment, bookingMode);
    if (verdict) {
      return verdict;
    }
  }

  switch (name) {
    case 'completed':
    case 'partly':
      return PaymentState.CAPTURED;
    case 'canceled':
      return PaymentState.CANCELLED;
    case 'pending':
      return bookingMode === 'authorize' ? PaymentState.AUTHORIZATION_REQUESTED : PaymentState.REDIRECTED;
    default:
      throw new PspError(`Uninterpretable Unzer payment state: '${payment.state?.name ?? ''}'`, 500);
  }
}

/** A settlement kind under a `success` leg: the settled state of that operation. */
const SETTLED_BY_KIND: Readonly<Partial<Record<SettlementKind, PaymentState>>> = {
  'payment.captured': PaymentState.CAPTURED,
  'payment.pending_capture': PaymentState.AUTHORIZED,
  'payment.cancelled': PaymentState.CANCELLED,
  'payment.refunded': PaymentState.REFUNDED,
  'payment.chargeback': PaymentState.CHARGEBACK,
};

/** The same kinds under a `pending` leg: the in-flight, no-transition state, so nothing is recorded yet. */
const PENDING_BY_KIND: Readonly<Partial<Record<SettlementKind, PaymentState>>> = {
  'payment.captured': PaymentState.CAPTURE_REQUESTED,
  'payment.pending_capture': PaymentState.AUTHORIZATION_REQUESTED,
  'payment.refunded': PaymentState.REFUND_REQUESTED,
  'payment.cancelled': PaymentState.CANCEL_REQUESTED,
};

/**
 * Interpret a webhook settlement: the event's `kind` selects the operation, the pointed-at leg's own outcome
 * decides the half (error -> FAILED, success -> settled, pending -> in-flight). Anything else defers to the
 * payment-level interpreter, so a genuinely unknown state still fails loud.
 */
export function unzerWebhookStatus(
  kind: SettlementKind,
  payment: UnzerPayment,
  leg: UnzerTransaction | undefined,
): PaymentState {
  switch (leg?.status) {
    case 'error':
      return PaymentState.FAILED;
    case 'success':
      return SETTLED_BY_KIND[kind] ?? unzerPaymentStatus(payment);
    case 'pending':
      return PENDING_BY_KIND[kind] ?? unzerPaymentStatus(payment);
    default:
      return unzerPaymentStatus(payment);
  }
}

const CHARGE_STATUS: Readonly<Record<string, PaymentState>> = {
  success: PaymentState.CAPTURED,
  pending: PaymentState.CAPTURE_REQUESTED,
  error: PaymentState.FAILED,
};

const AUTHORIZATION_STATUS: Readonly<Record<string, PaymentState>> = {
  success: PaymentState.AUTHORIZED,
  pending: PaymentState.AUTHORIZATION_REQUESTED,
  error: PaymentState.FAILED,
};

/**
 * One leg's kind and outcome -> the operation state the panel and the reconciliation read. A reversal counts
 * only once settled. `undefined` for a pair this interpreter does not recognise, so one uninterpretable leg
 * costs that leg alone and never the whole payment read.
 */
export function unzerOperationStatus(leg: UnzerTransaction): PaymentState | undefined {
  const status = leg.status ?? '';
  switch (legKind(leg)) {
    case 'charge':
      return CHARGE_STATUS[status];
    case 'authorization':
      return AUTHORIZATION_STATUS[status];
    case 'refund':
      return status === 'success' ? PaymentState.REFUNDED : undefined;
    case 'void':
      return status === 'success' ? PaymentState.CANCELLED : undefined;
    case 'chargeback':
      return status === 'success' ? PaymentState.CHARGEBACK : undefined;
    default:
      return undefined;
  }
}
