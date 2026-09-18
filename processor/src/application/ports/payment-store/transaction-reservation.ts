import type { Money } from '../../../domain';
import type { ReservedLeg } from './reserved-leg';

/** The leg a reservation writes: `Pending` by definition, for the money the operation moves. */
export interface TransactionReservation extends ReservedLeg {
  amount: Money;
}
