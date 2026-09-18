import type { Money, PaymentDetailsAmounts, ProviderOperation, ProviderPaymentDetails } from '../../../domain';
import { scrubDisplayString } from '../../../domain';
import { fractionDigitsForCurrency, fromDecimalAmount, type UnzerPayment, type UnzerTransaction } from '../client';
import { legKind, operationIdentity, toRawStatus, unzerOperationStatus } from '../status';
import { legDateIso } from './leg-date';

/** The leg's display kind: the canonical name for an interpreted kind, the scrubbed vendor string otherwise. */
export function displayType(leg: UnzerTransaction): string | undefined {
  switch (legKind(leg)) {
    case 'void':
      return 'reversal';
    case 'refund':
      return 'refund';
    case 'authorization':
      return 'authorization';
    case 'charge':
      return 'charge';
    case 'chargeback':
      return 'chargeback';
    default:
      return leg.type === undefined ? undefined : scrubDisplayString(leg.type);
  }
}

function legOutcome(status: string | undefined): 'success' | 'pending' | 'error' | undefined {
  return status === 'success' || status === 'pending' || status === 'error' ? status : undefined;
}

/** The sum over the succeeded legs a predicate selects; `undefined` when none contributed. */
function sumLegs(
  legs: UnzerTransaction[],
  currency: string | undefined,
  fractionDigits: number,
  predicate: (leg: UnzerTransaction) => boolean,
): Money | undefined {
  return legs.reduce<Money | undefined>((sum, leg) => {
    if (leg.status !== 'success' || !predicate(leg)) {
      return sum;
    }
    const amount = fromDecimalAmount(leg.amount, currency, fractionDigits);
    if (!amount) {
      return sum;
    }
    return sum ? { centAmount: sum.centAmount + amount.centAmount, currencyCode: sum.currencyCode } : amount;
  }, undefined);
}

/**
 * The display amount book: `total` and `charged` from the vendor's own book, the reversal figures summed over
 * the succeeded legs by display kind. A figure with nothing behind it is omitted, never invented as zero.
 */
function toAmounts(payment: UnzerPayment): PaymentDetailsAmounts | undefined {
  const legs = payment.transactions ?? [];
  const currency = payment.currency;
  const fractionDigits = fractionDigitsForCurrency(currency);
  const total = fromDecimalAmount(payment.amount?.total, currency, fractionDigits);
  const authorized = sumLegs(legs, currency, fractionDigits, (leg) => legKind(leg) === 'authorization');
  const charged = fromDecimalAmount(payment.amount?.charged, currency, fractionDigits);
  const cancelled = sumLegs(legs, currency, fractionDigits, (leg) => displayType(leg) === 'reversal');
  const refunded = sumLegs(legs, currency, fractionDigits, (leg) => displayType(leg) === 'refund');
  const amounts = {
    ...(total ? { total } : {}),
    ...(authorized ? { authorized } : {}),
    ...(charged ? { charged } : {}),
    ...(cancelled ? { cancelled } : {}),
    ...(refunded ? { refunded } : {}),
  };
  return Object.keys(amounts).length > 0 ? amounts : undefined;
}

/**
 * The transaction legs -> the neutral operation list. A leg's identity is charge-scoped; a leg the interpreter
 * cannot read carries a diagnostic `rawStatus` the status map refuses, so it costs that leg alone.
 */
export function toProviderOperations(
  transactions: UnzerTransaction[] | undefined,
  currency: string | undefined,
): ProviderOperation[] {
  const fractionDigits = fractionDigitsForCurrency(currency);
  return (transactions ?? []).map((transaction) => {
    const id = operationIdentity(transaction.url) || undefined;
    const type = displayType(transaction);
    const outcome = legOutcome(transaction.status);
    const amount = fromDecimalAmount(transaction.amount, currency, fractionDigits);
    const state = unzerOperationStatus(transaction);
    return {
      ...(id ? { id } : {}),
      ...(type ? { type } : {}),
      ...(transaction.date ? { date: legDateIso(transaction.date) } : {}),
      ...(outcome ? { outcome } : {}),
      ...(amount ? { amount } : {}),
      rawStatus: state
        ? toRawStatus(state)
        : { state: `${transaction.type ?? 'unknown'}:${transaction.status ?? 'unknown'}` },
    };
  });
}

/** One `GET /v1/payments/{id}` -> the panel's details; the state name and `orderId` are PAN-scrubbed display lifts. */
export function toPaymentDetails(payment: UnzerPayment): ProviderPaymentDetails {
  const amounts = toAmounts(payment);
  return {
    displayStatus: scrubDisplayString(payment.state?.name ?? ''),
    ...(payment.orderId ? { orderId: scrubDisplayString(payment.orderId) } : {}),
    ...(amounts ? { amounts } : {}),
    operations: toProviderOperations(payment.transactions, payment.currency),
  };
}
