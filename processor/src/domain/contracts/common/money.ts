import type { CentAmount } from './cent-amount';

/** A minor-unit integer amount paired with its ISO-4217 currency code. */
export interface Money {
  centAmount: CentAmount;
  currencyCode: string;
}
