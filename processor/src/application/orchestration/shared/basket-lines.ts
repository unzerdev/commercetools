import type { Cart } from '@commercetools/connect-payments-sdk';
import type { BasketLine } from '../../../domain';
import { resolveLocalized } from './localized-text';

/** The cart's total gross shipping cost, summed over a multi-shipping cart. */
function cartShippingGross(cart: Cart): number {
  const shipments = cart.shipping?.length ? cart.shipping.map((entry) => entry.shippingInfo) : [cart.shippingInfo];
  return shipments.reduce(
    (sum, info) => sum + (info?.taxedPrice?.totalGross?.centAmount ?? info?.price?.centAmount ?? 0),
    0,
  );
}

/** A line's gross price per unit, derived from the taxed line total; a residue lands on the rounding line. */
function lineItemPerUnitGross(item: Cart['lineItems'][number]): number {
  const grossTotal = item.taxedPrice?.totalGross?.centAmount ?? item.totalPrice.centAmount;
  return item.quantity > 0 ? Math.round(grossTotal / item.quantity) : grossTotal;
}

/** The tax rate as the percent the vendor expects, rounded to four decimals. */
function toVatPercent(fraction: number): number {
  return Math.round(fraction * 100 * 10_000) / 10_000;
}

/** What a set of basket lines sums to in minor units, by the vendor's own arithmetic. */
function basketLinesTotal(lines: BasketLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.amountPerUnitGross * line.quantity - line.amountDiscountPerUnitGross,
    0,
  );
}

/**
 * Basket lines that sum exactly to the charged amount: shipment, one line per cart line, a cart-level
 * discount, a named surcharge line, and a rounding adjustment for whatever the others cannot express.
 */
export function buildBasketLines(cart: Cart, chargedGrossCents: number, surchargeCents = 0): BasketLine[] {
  const lines: BasketLine[] = [];

  const shippingGross = cartShippingGross(cart);
  if (shippingGross > 0) {
    lines.push({
      title: 'Shipment',
      quantity: 1,
      amountPerUnitGross: shippingGross,
      amountDiscountPerUnitGross: 0,
      vat: 0,
      type: 'shipment',
    });
  }

  let vatPercent = 0;
  for (const item of cart.lineItems) {
    if (item.taxRate?.amount !== undefined) {
      vatPercent = toVatPercent(item.taxRate.amount);
    }
    lines.push({
      title: resolveLocalized(item.name, cart.locale),
      quantity: item.quantity,
      amountPerUnitGross: lineItemPerUnitGross(item),
      amountDiscountPerUnitGross: 0,
      vat: item.taxRate?.amount !== undefined ? toVatPercent(item.taxRate.amount) : 0,
      type: 'goods',
    });
  }

  const discountGross =
    cart.discountOnTotalPrice?.discountedGrossAmount?.centAmount ??
    cart.discountOnTotalPrice?.discountedAmount?.centAmount ??
    0;
  if (discountGross > 0) {
    lines.push({
      title: 'Discount',
      quantity: 1,
      amountPerUnitGross: 0,
      amountDiscountPerUnitGross: discountGross,
      vat: vatPercent,
      type: 'voucher',
    });
  }

  if (surchargeCents > 0) {
    lines.push({
      title: 'Payment surcharge',
      quantity: 1,
      amountPerUnitGross: surchargeCents,
      amountDiscountPerUnitGross: 0,
      vat: 0,
      type: 'goods',
    });
  }

  const difference = chargedGrossCents - basketLinesTotal(lines);
  if (difference !== 0) {
    lines.push({
      title: 'Rounding Adjustment',
      quantity: 1,
      amountPerUnitGross: difference > 0 ? difference : 0,
      amountDiscountPerUnitGross: difference < 0 ? -difference : 0,
      vat: 0,
      type: 'voucher',
    });
  }

  return lines;
}
