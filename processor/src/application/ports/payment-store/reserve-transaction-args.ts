import type { TransactionReservation } from './transaction-reservation';

/** The reservation write, under the version the caller sized its headroom against. */
export interface ReserveTransactionArgs {
  id: string;
  version: number;
  transaction: TransactionReservation;
}
