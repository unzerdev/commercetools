/**
 * Basket assembly — the port of the reference integration's `createBasketForOrder`.
 *
 * Unzer validates a basket ARITHMETICALLY: the basket's `totalValueGross` must equal the sum of its
 * lines, where a `goods`/`shipment` line adds `amountPerUnitGross * quantity` and a `voucher` line
 * subtracts `amountDiscountPerUnitGross`. A basket that does not balance is rejected, and the charge
 * fails with it — so the invariant every test here asserts is that the lines sum to the charged amount.
 *
 * Four line kinds exist, in the order the reference integration emits them: the shipping line, the
 * product lines, one voucher line for a cart-level discount, and a final "Rounding Adjustment" voucher
 * that absorbs whatever the first three could not express. The rounding line carries more weight here
 * than in the reference integration, because the charged amount is the cart total PLUS the method
 * surcharge and that surcharge belongs to no cart line.
 */
import { describe, expect, it } from '@jest/globals';
import type { Cart } from '@commercetools/connect-payments-sdk';
import type { BasketLine } from '../src/domain';
import { buildBasketLines } from '../src/application/orchestration';
import { toUnzerBasket } from '../src/providers/psp/mapping';

/**
 * A cart carrying the given line items, plus whatever else a case needs. Only the fields the assembler
 * reads are present — the CT `Cart` is far wider than the basket needs.
 */
function cart(over: Record<string, unknown> = {}): Cart {
  return {
    id: 'cart-1',
    locale: 'en',
    totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
    lineItems: [
      {
        name: { en: 'Widget' },
        quantity: 2,
        price: { value: { centAmount: 750, currencyCode: 'EUR' } },
        taxRate: { amount: 0.19 },
        totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
        taxedPrice: { totalGross: { centAmount: 1500, currencyCode: 'EUR' } },
      },
    ],
    ...over,
  } as unknown as Cart;
}

/** What the lines sum to, in minor units: goods and shipment add, vouchers subtract. */
function linesTotal(lines: BasketLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.amountPerUnitGross * line.quantity - (line.amountDiscountPerUnitGross ?? 0),
    0,
  );
}

describe('buildBasketLines — product lines', () => {
  it('emits one goods line per cart line with the gross per-unit price and the quantity', () => {
    const lines = buildBasketLines(cart(), 1500);

    expect(lines).toEqual([
      { title: 'Widget', quantity: 2, amountPerUnitGross: 750, amountDiscountPerUnitGross: 0, vat: 19, type: 'goods' },
    ]);
  });

  // The vendor rejects a basket whose ANY line omits `vat` (`API.600.410.052`), even though its published
  // schema does not list the field as required. The reference integration never hits that because its SDK
  // defaults the property to 0 and serializes it on every line — so every line carries a `vat`, always.
  it('carries a vat on EVERY line kind, defaulting to zero where the cart has no rate', () => {
    const lines = buildBasketLines(
      cart({
        lineItems: [lineItem({ taxRate: undefined })],
        shippingInfo: { taxedPrice: { totalGross: { centAmount: 495, currencyCode: 'EUR' } } },
        discountOnTotalPrice: { discountedAmount: { centAmount: 200, currencyCode: 'EUR' } },
      }),
      1945,
    );

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(typeof line.vat).toBe('number');
    }
    expect(lines.map((line) => line.vat)).toEqual([0, 0, 0, 0]);
  });

  // The cart carries the tax rate as a FRACTION; Unzer and the reference integration both expect
  // the PERCENT. Sending 0.19 understates the line's tax by two orders of magnitude.
  it('converts the cart tax fraction into the percent the vendor expects', () => {
    const lines = buildBasketLines(cart({ lineItems: [lineItem({ taxRate: { amount: 0.077 } })] }), 1500);

    expect(lines[0]?.vat).toBe(7.7);
  });

  it('falls back to a zero vat when the cart line carries no tax rate', () => {
    const lines = buildBasketLines(cart({ lineItems: [lineItem({ taxRate: undefined })] }), 1500);

    expect(lines[0]?.vat).toBe(0);
  });

  it('reads the per-unit gross from the taxed price, not the catalogue price', () => {
    // A net-priced cart: the catalogue price is 750 net, the taxed gross total is 1785 for 2 units.
    const lines = buildBasketLines(
      cart({
        lineItems: [
          lineItem({
            price: { value: { centAmount: 750, currencyCode: 'EUR' } },
            taxedPrice: { totalGross: { centAmount: 1785, currencyCode: 'EUR' } },
          }),
        ],
      }),
      1785,
    );

    expect(lines[0]?.amountPerUnitGross).toBe(893);
  });
});

describe('buildBasketLines — shipping line', () => {
  // The shipping line's `vat` is ZERO, not the cart's shipping tax rate. That is what the reference
  // integration sends: its shipping item sets no vat at all, and its SDK serializes the property's own
  // zero default. The basket is validated on its GROSS sum, which the gross shipping price already
  // carries, so the tax figure on this line is informational.
  it('emits the shipping line FIRST, as a shipment line carrying the gross shipping price', () => {
    const lines = buildBasketLines(
      cart({
        shippingInfo: {
          taxedPrice: { totalGross: { centAmount: 495, currencyCode: 'EUR' } },
          taxRate: { amount: 0.19 },
        },
      }),
      1995,
    );

    expect(lines[0]).toEqual({
      title: 'Shipment',
      quantity: 1,
      amountPerUnitGross: 495,
      amountDiscountPerUnitGross: 0,
      vat: 0,
      type: 'shipment',
    });
    expect(linesTotal(lines)).toBe(1995);
  });

  it('sums the per-shipment gross prices of a multi-shipping cart', () => {
    const lines = buildBasketLines(
      cart({
        shipping: [
          { shippingInfo: { taxedPrice: { totalGross: { centAmount: 300, currencyCode: 'EUR' } } } },
          { shippingInfo: { taxedPrice: { totalGross: { centAmount: 200, currencyCode: 'EUR' } } } },
        ],
      }),
      2000,
    );

    expect(lines[0]).toMatchObject({ type: 'shipment', amountPerUnitGross: 500 });
    expect(linesTotal(lines)).toBe(2000);
  });

  it('emits no shipping line for a cart with no shipping cost', () => {
    const lines = buildBasketLines(cart(), 1500);

    expect(lines.some((line) => line.type === 'shipment')).toBe(false);
  });
});

describe('buildBasketLines — discount voucher line', () => {
  it('emits a voucher line carrying the gross cart-level discount and a zero price', () => {
    const lines = buildBasketLines(
      cart({
        discountOnTotalPrice: {
          discountedAmount: { centAmount: 200, currencyCode: 'EUR' },
          discountedGrossAmount: { centAmount: 238, currencyCode: 'EUR' },
        },
      }),
      1262,
    );

    expect(lines.at(-1)).toEqual({
      title: 'Discount',
      quantity: 1,
      amountPerUnitGross: 0,
      amountDiscountPerUnitGross: 238,
      vat: 19,
      type: 'voucher',
    });
    expect(linesTotal(lines)).toBe(1262);
  });

  it('falls back to the plain discounted amount when the cart carries no gross figure', () => {
    const lines = buildBasketLines(
      cart({ discountOnTotalPrice: { discountedAmount: { centAmount: 200, currencyCode: 'EUR' } } }),
      1300,
    );

    expect(lines.at(-1)).toMatchObject({ type: 'voucher', amountDiscountPerUnitGross: 200 });
  });
});

describe('buildBasketLines — rounding adjustment', () => {
  // The method surcharge is charged but belongs to no cart line, so without this line the basket
  // would be 150 short of the charged amount and Unzer would refuse it.
  it('absorbs a method surcharge as a positive rounding line', () => {
    const lines = buildBasketLines(cart(), 1650);

    expect(lines.at(-1)).toEqual({
      title: 'Rounding Adjustment',
      quantity: 1,
      amountPerUnitGross: 150,
      amountDiscountPerUnitGross: 0,
      vat: 0,
      type: 'voucher',
    });
    expect(linesTotal(lines)).toBe(1650);
  });

  it('absorbs an overshoot as a discount on the rounding line', () => {
    // Three units at 333 each is 999, one minor unit above a 998 charged total.
    const lines = buildBasketLines(
      cart({
        lineItems: [lineItem({ quantity: 3, taxedPrice: { totalGross: { centAmount: 999, currencyCode: 'EUR' } } })],
      }),
      998,
    );

    expect(lines.at(-1)).toEqual({
      title: 'Rounding Adjustment',
      quantity: 1,
      amountPerUnitGross: 0,
      amountDiscountPerUnitGross: 1,
      vat: 0,
      type: 'voucher',
    });
    expect(linesTotal(lines)).toBe(998);
  });

  it('emits no rounding line when the lines already sum to the charged amount', () => {
    const lines = buildBasketLines(cart(), 1500);

    expect(lines.some((line) => line.title === 'Rounding Adjustment')).toBe(false);
  });

  // The residue of an indivisible per-unit gross has to land somewhere: 1000 over 3 units is 333 each,
  // and the missing minor unit is exactly what the rounding line is for.
  it('absorbs the residue of a per-unit gross that does not divide evenly', () => {
    const lines = buildBasketLines(
      cart({
        lineItems: [lineItem({ quantity: 3, taxedPrice: { totalGross: { centAmount: 1000, currencyCode: 'EUR' } } })],
      }),
      1000,
    );

    expect(linesTotal(lines)).toBe(1000);
  });
});

describe('buildBasketLines — the full reference order', () => {
  it('emits shipping, then products, then the discount, then the rounding adjustment', () => {
    const lines = buildBasketLines(
      cart({
        shippingInfo: { taxedPrice: { totalGross: { centAmount: 495, currencyCode: 'EUR' } } },
        discountOnTotalPrice: { discountedAmount: { centAmount: 200, currencyCode: 'EUR' } },
      }),
      1945,
    );

    expect(lines.map((line) => line.title)).toEqual(['Shipment', 'Widget', 'Discount', 'Rounding Adjustment']);
    expect(linesTotal(lines)).toBe(1945);
  });
});

describe('toUnzerBasket', () => {
  it('serializes the required trio plus one reference id per line', () => {
    const basket = toUnzerBasket(buildBasketLines(cart(), 1500), 1500, 'EUR', 2, 'order-42');

    expect(basket).toEqual({
      totalValueGross: '15.00',
      currencyCode: 'EUR',
      orderId: 'order-42',
      basketItems: [
        {
          basketItemReferenceId: 'line-0',
          title: 'Widget',
          quantity: 2,
          amountPerUnitGross: '7.50',
          amountDiscountPerUnitGross: '0.00',
          vat: 19,
          type: 'goods',
        },
      ],
    });
  });

  it('serializes a 0-exponent currency as bare integers', () => {
    const lines = buildBasketLines(
      cart({
        totalPrice: { centAmount: 1000, currencyCode: 'JPY' },
        lineItems: [
          lineItem({
            quantity: 1,
            taxRate: undefined,
            taxedPrice: { totalGross: { centAmount: 1000, currencyCode: 'JPY' } },
          }),
        ],
      }),
      1000,
    );

    const basket = toUnzerBasket(lines, 1000, 'JPY', 0, 'order-42');

    expect(basket.totalValueGross).toBe('1000');
    expect(basket.basketItems[0]).toMatchObject({ amountPerUnitGross: '1000', amountDiscountPerUnitGross: '0' });
  });

  // The vendor refuses a basket item with no `vat` (`API.600.410.052`), so the field is unconditional on
  // the wire — an omitted one is what a live sandbox charge failed on.
  it('serializes a vat on every item, including a zero one', () => {
    const lines = buildBasketLines(cart({ lineItems: [lineItem({ taxRate: undefined })] }), 1500);

    const basket = toUnzerBasket(lines, 1500, 'EUR', 2, 'order-42');

    for (const item of basket.basketItems) {
      expect(item.vat).toBe(0);
    }
  });
});

/** One cart line item, defaulting to the fixture's Widget. */
function lineItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: { en: 'Widget' },
    quantity: 2,
    price: { value: { centAmount: 750, currencyCode: 'EUR' } },
    taxRate: { amount: 0.19 },
    totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
    taxedPrice: { totalGross: { centAmount: 1500, currencyCode: 'EUR' } },
    ...over,
  };
}
