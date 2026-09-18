import type { Money } from '../../../domain';
import type { Payment } from '../../ports';

/** What a payment still has room to move; commercetools, not the vendor, is the source of truth. */
export interface PaymentAmounts {
  capturable: Money;
  refundable: Money;
}

const SETTLED: ReadonlySet<string> = new Set(['Success']);

/** Money spoken for: settled, or accepted by the vendor and awaiting its webhook. */
const COMMITTED: ReadonlySet<string> = new Set(['Success', 'Pending', 'Initial']);

function total(payment: Payment, type: string, states: ReadonlySet<string>): number {
  return payment.transactions
    .filter((transaction) => transaction.type === type && states.has(transaction.state))
    .reduce((sum, transaction) => sum + transaction.amount.centAmount, 0);
}

const money = (centAmount: number, currencyCode: string): Money => ({
  centAmount: Math.max(centAmount, 0),
  currencyCode,
});

/**
 * Capturable is bounded by the settled authorization minus every capture and void in flight; refundable is
 * settled captures minus every refund in flight. Never negative.
 */
export function paymentAmounts(payment: Payment): PaymentAmounts {
  const { currencyCode, centAmount: planned } = payment.amountPlanned;

  const paid = total(payment, 'Charge', SETTLED);
  const authorized = total(payment, 'Authorization', SETTLED);
  const capturing = total(payment, 'Charge', COMMITTED);
  const cancelling = total(payment, 'CancelAuthorization', COMMITTED);
  const refunding = total(payment, 'Refund', COMMITTED);

  return {
    capturable: money(authorized === 0 ? 0 : Math.min(planned, authorized) - capturing - cancelling, currencyCode),
    refundable: money(paid - refunding, currencyCode),
  };
}
