import type { Payment } from '../payment-store';

/** An Order with its Payments already expanded: the whole panel read in one call. */
export interface OrderWithPayments {
  id: string;
  payments: Payment[];
}
