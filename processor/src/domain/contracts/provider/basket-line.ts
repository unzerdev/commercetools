import type { CentAmount } from '../common';

/** One basket line: priced (`goods`/`shipment`) or a discount (`voucher`). The vendor sums them arithmetically. */
export interface BasketLine {
  title: string;
  quantity: number;
  amountPerUnitGross: CentAmount;
  amountDiscountPerUnitGross: CentAmount;
  /** Tax rate as a percent; mandatory on the wire. */
  vat: number;
  type: string;
}
