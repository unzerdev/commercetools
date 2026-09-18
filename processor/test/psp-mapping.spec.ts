import { describe, expect, it } from '@jest/globals';
import { PaymentState } from '../src/domain';
import {
  pspCustomFields,
  redirectAction,
  timingSafeEquals,
  toPaymentDetails,
  toProviderOperations,
  transferInstructions,
} from '../src/providers/psp/mapping';
import { mapProviderStatus, toRawStatus } from '../src/providers/psp/status';
import { readStringField } from '../src/domain';
import type { UnzerPayment, UnzerTransaction } from '../src/providers/psp/client';

describe('toRawStatus - the provider status envelope', () => {
  it('carries the interpreted state, which is what the status map validates', () => {
    expect(toRawStatus(PaymentState.CAPTURED)).toEqual({ state: PaymentState.CAPTURED });
    expect(mapProviderStatus(toRawStatus(PaymentState.CAPTURED))).toBe(PaymentState.CAPTURED);
  });
});

describe('toProviderOperations - the Unzer transaction legs → the reconciliation contract', () => {
  it('carries each leg id (from the url), the amount (from the decimal wire string) and the interpreted status', () => {
    const transactions: UnzerTransaction[] = [
      {
        type: 'charge',
        status: 'success',
        url: 'https://api.unzer.com/v1/payments/pay-1/charges/chg-1',
        amount: '10.00',
      },
    ];

    expect(toProviderOperations(transactions, 'EUR')).toEqual([
      {
        id: 'chg-1',
        type: 'charge',
        outcome: 'success',
        amount: { centAmount: 1000, currencyCode: 'EUR' },
        rawStatus: { state: 'CAPTURED' },
      },
    ]);
  });

  // The reconciliation reads each operation's status through `mapProviderStatus`; a leg fed raw (its
  // Unzer `type`) would throw `Unmapped PSP status`. The interpreted status is one the table maps.
  it('yields a charge-success leg whose status maps to CAPTURED, never a throw', () => {
    const [op] = toProviderOperations(
      [{ type: 'charge', status: 'success', url: 'https://sbx-api.unzer.com/v1/payments/pay-1/charges/chg-1' }],
      'EUR',
    );

    expect(mapProviderStatus(op.rawStatus)).toBe(PaymentState.CAPTURED);
  });

  // The leg id is the trailing path segment; a query string on the resource url is not part of it.
  it('strips a trailing query when deriving the leg id from the url', () => {
    const [op] = toProviderOperations(
      [
        {
          type: 'charge',
          status: 'success',
          url: 'https://api.unzer.com/v1/payments/pay-1/charges/chg-1?foo=bar',
          amount: '10.00',
        },
      ],
      'EUR',
    );

    expect(op.id).toBe('chg-1');
  });

  it('omits the id, amount and date when the leg carries none', () => {
    const [mapped] = toProviderOperations([{ type: 'authorization', status: 'success' }], 'EUR');

    expect(mapped).toEqual({
      type: 'authorization',
      outcome: 'success',
      rawStatus: { state: 'AUTHORIZED' },
    });
    expect(mapped).not.toHaveProperty('id');
    expect(mapped).not.toHaveProperty('amount');
    expect(mapped).not.toHaveProperty('date');
  });

  it('yields an empty list for an absent or empty leg list, never a throw', () => {
    expect(toProviderOperations(undefined, 'EUR')).toEqual([]);
    expect(toProviderOperations([], 'EUR')).toEqual([]);
  });

  // The display projection: the leg kind (a cancellation named by what it reversed - the URL is the
  // same discriminator the status interpretation trusts), the vendor date, and the leg's own outcome.
  it('emits the display kind, date and outcome per leg, splitting a cancellation into refund vs reversal by its url', () => {
    const operations = toProviderOperations(
      [
        {
          type: 'cancellation',
          status: 'success',
          date: '2026-07-03 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-1/charges/chg-1/cancels/cnl-1',
          amount: '10.00',
        },
        {
          type: 'cancellation',
          status: 'success',
          date: '2026-07-04 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-1/authorize/aut-1/cancels/cnl-2',
          amount: '5.00',
        },
      ],
      'EUR',
    );

    expect(operations).toEqual([
      {
        // Charge scoped: Unzer numbers a cancellation within its parent charge, so the charge is part
        // of the identity - two refunds of one payment would otherwise share `cnl-1`.
        id: 'chg-1.cnl-1',
        type: 'refund',
        date: '2026-07-03T10:00:00Z',
        outcome: 'success',
        amount: { centAmount: 1000, currencyCode: 'EUR' },
        rawStatus: { state: 'REFUNDED' },
      },
      {
        id: 'cnl-2',
        type: 'reversal',
        date: '2026-07-04T10:00:00Z',
        outcome: 'success',
        amount: { centAmount: 500, currencyCode: 'EUR' },
        rawStatus: { state: 'CANCELLED' },
      },
    ]);
  });

  // The leg date basis: Unzer's wire format is the offset-less `YYYY-MM-DD HH:mm:ss` in UTC (the
  // vendor's own java-sdk parses it at ZoneId "UTC"), but the panel's `intl.formatDate` reads an
  // offset-less string as the VIEWER'S local time - so the mapper rewrites it to the offset-carrying
  // ISO form. Anything already carrying an offset, or not parseable at all, passes verbatim: the
  // field is display-only and never worth a throw.
  it('rewrites the offset-less vendor timestamp to the offset-carrying ISO form (UTC)', () => {
    const [operation] = toProviderOperations(
      [{ type: 'charge', status: 'success', date: '2026-07-03 10:00:00' }],
      'EUR',
    );

    expect(operation.date).toBe('2026-07-03T10:00:00Z');
  });

  it('rewrites the offset-less shape WITH fractional seconds too - same UTC basis', () => {
    const [operation] = toProviderOperations(
      [{ type: 'charge', status: 'success', date: '2026-07-03 10:00:00.123' }],
      'EUR',
    );

    expect(operation.date).toBe('2026-07-03T10:00:00.123Z');
  });

  it('passes an already offset-carrying ISO date through unchanged', () => {
    const legs: UnzerTransaction[] = [
      { type: 'charge', status: 'success', date: '2026-07-03T10:00:00Z' },
      { type: 'charge', status: 'success', date: '2026-07-03T10:00:00.000+02:00' },
    ];

    expect(toProviderOperations(legs, 'EUR').map((operation) => operation.date)).toEqual([
      '2026-07-03T10:00:00Z',
      '2026-07-03T10:00:00.000+02:00',
    ]);
  });

  it('passes a date outside both shapes through verbatim - display-only, never a throw', () => {
    const [operation] = toProviderOperations([{ type: 'charge', status: 'success', date: 'not-a-date' }], 'EUR');

    expect(operation.date).toBe('not-a-date');
  });

  it('reads a cancellation whose url names neither parent as a refund - the direction the status interpretation takes', () => {
    const [operation] = toProviderOperations([{ type: 'cancellation', status: 'success', amount: '2.00' }], 'EUR');

    expect(operation).toMatchObject({ type: 'refund', rawStatus: { state: 'REFUNDED' } });
  });

  // The display-string scrub: with no card-bearing member on the contract, the one place a PAN could
  // still ride is a DECLARED display string - and the verbatim leg-kind fallback is such a lift. The
  // closed kinds ('authorization'/'charge'/'refund'/'reversal') are digit-free by construction; only a
  // string carrying 12+ digits (the shortest PAN a scheme issues) is rewritten, to its last 4 digits.
  it('masks a PAN carried in an unrecognised leg kind - only the last 4 digits survive', () => {
    const [operation] = toProviderOperations([{ type: '4111111111111111', status: 'success' }], 'EUR');

    expect(operation.type).toBe('************1111');
  });

  it('passes an unrecognised leg kind through verbatim and omits an outcome outside the tri-state', () => {
    const [operation] = toProviderOperations(
      [{ type: 'chargeback', status: 'resumed', url: 'https://api.unzer.com/v1/payments/pay-1/chargebacks/cbk-1' }],
      'EUR',
    );

    expect(operation).toEqual({
      id: 'cbk-1',
      type: 'chargeback',
      rawStatus: { state: 'chargeback:resumed' },
    });
    expect(operation).not.toHaveProperty('outcome');
  });
});

describe('toPaymentDetails - the Unzer payment resource → the neutral single-payment read', () => {
  it('maps the coarse state name and the transaction legs onto the contract', () => {
    const payment: UnzerPayment = {
      id: 'pay-1',
      state: { name: 'completed' },
      currency: 'EUR',
      transactions: [
        {
          type: 'charge',
          status: 'success',
          url: 'https://api.unzer.com/v1/payments/pay-1/charges/chg-1',
          amount: '25.00',
        },
      ],
    };

    expect(toPaymentDetails(payment)).toEqual({
      displayStatus: 'completed',
      operations: [
        {
          id: 'chg-1',
          type: 'charge',
          outcome: 'success',
          amount: { centAmount: 2500, currencyCode: 'EUR' },
          rawStatus: { state: 'CAPTURED' },
        },
      ],
    });
  });

  it('yields a bare status with an empty operation list for a payment with no legs', () => {
    expect(toPaymentDetails({ id: 'pay-2', state: { name: 'pending' } })).toEqual({
      displayStatus: 'pending',
      operations: [],
    });
  });

  it('reports an empty status string when the payment carries no state', () => {
    expect(toPaymentDetails({ id: 'pay-3' }).displayStatus).toBe('');
  });

  // The display amount book: total/charged verbatim from the vendor book, the three reversal figures as
  // sums over the succeeded legs (the book's cumulative `canceled` cannot split a refund from a void -
  // the leg URLs can). The vendor `orderId` rides the same read.
  it('carries the vendor orderId and the amount book derived from the book and the succeeded legs', () => {
    const payment: UnzerPayment = {
      id: 'pay-9',
      state: { name: 'partly' },
      orderId: 'ct-pay-1',
      currency: 'EUR',
      amount: { total: '50.00', charged: '30.00', canceled: '15.00', remaining: '20.00' },
      transactions: [
        {
          type: 'authorization',
          status: 'success',
          date: '2026-07-01 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-9/authorize/aut-1',
          amount: '50.00',
        },
        {
          type: 'charge',
          status: 'success',
          date: '2026-07-02 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-9/charges/chg-1',
          amount: '30.00',
        },
        {
          type: 'cancellation',
          status: 'success',
          date: '2026-07-03 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-9/charges/chg-1/cancels/cnl-1',
          amount: '10.00',
        },
        {
          type: 'cancellation',
          status: 'success',
          date: '2026-07-04 10:00:00',
          url: 'https://api.unzer.com/v1/payments/pay-9/authorize/aut-1/cancels/cnl-2',
          amount: '5.00',
        },
        { type: 'chargeback', status: 'resumed', url: 'https://api.unzer.com/v1/payments/pay-9/chargebacks/cbk-1' },
      ],
    };

    expect(toPaymentDetails(payment)).toEqual({
      displayStatus: 'partly',
      orderId: 'ct-pay-1',
      amounts: {
        total: { centAmount: 5000, currencyCode: 'EUR' },
        authorized: { centAmount: 5000, currencyCode: 'EUR' },
        charged: { centAmount: 3000, currencyCode: 'EUR' },
        cancelled: { centAmount: 500, currencyCode: 'EUR' },
        refunded: { centAmount: 1000, currencyCode: 'EUR' },
      },
      operations: [
        {
          id: 'aut-1',
          type: 'authorization',
          date: '2026-07-01T10:00:00Z',
          outcome: 'success',
          amount: { centAmount: 5000, currencyCode: 'EUR' },
          rawStatus: { state: 'AUTHORIZED' },
        },
        {
          id: 'chg-1',
          type: 'charge',
          date: '2026-07-02T10:00:00Z',
          outcome: 'success',
          amount: { centAmount: 3000, currencyCode: 'EUR' },
          rawStatus: { state: 'CAPTURED' },
        },
        {
          id: 'chg-1.cnl-1',
          type: 'refund',
          date: '2026-07-03T10:00:00Z',
          outcome: 'success',
          amount: { centAmount: 1000, currencyCode: 'EUR' },
          rawStatus: { state: 'REFUNDED' },
        },
        {
          id: 'cnl-2',
          type: 'reversal',
          date: '2026-07-04T10:00:00Z',
          outcome: 'success',
          amount: { centAmount: 500, currencyCode: 'EUR' },
          rawStatus: { state: 'CANCELLED' },
        },
        { id: 'cbk-1', type: 'chargeback', rawStatus: { state: 'chargeback:resumed' } },
      ],
    });
  });

  // The vocabulary a LIVE `GET /v1/payments/{id}` really answers with, captured from a sandbox payment
  // refunded four times through the Unzer portal. Every refund leg is typed `cancel-charge`, so before it
  // was read the panel summed nothing into `refunded` (reporting 0.00 against real money returned) and
  // labelled each leg with the raw wire string instead of naming it a refund.
  it('reads the vendor transaction-type names in the amount book and the operation kinds', () => {
    const payment: UnzerPayment = {
      id: 's-pay-12685',
      state: { name: 'completed' },
      currency: 'EUR',
      orderId: 'c948cdb6-771c-47e1-9e70-af81320b7392',
      amount: { total: '2645.9900', charged: '2466.9900', canceled: '179.0000' },
      transactions: [
        {
          type: 'charge',
          status: 'success',
          date: '2026-09-03 12:42:29',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1',
          amount: '2645.9900',
        },
        {
          type: 'cancel-charge',
          status: 'success',
          date: '2026-09-03 12:45:23',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-1',
          amount: '176.0000',
        },
        {
          type: 'cancel-charge',
          status: 'success',
          date: '2026-09-03 12:48:19',
          url: 'https://api.unzer.com/v1/payments/s-pay-12685/charges/s-chg-1/cancels/s-cnl-2',
          amount: '1.0000',
        },
      ],
    };

    const details = toPaymentDetails(payment);

    // The refunds SUM (176.00 + 1.00), and `charged` stays the vendor's own book figure - which Unzer
    // decrements as refunds settle, so it is not the captured total and is never derived from the legs.
    expect(details.amounts).toEqual({
      total: { centAmount: 264599, currencyCode: 'EUR' },
      charged: { centAmount: 246699, currencyCode: 'EUR' },
      refunded: { centAmount: 17700, currencyCode: 'EUR' },
    });
    expect(details.operations?.map((operation) => operation.type)).toEqual(['charge', 'refund', 'refund']);
    expect(details.operations?.[1]).toMatchObject({
      id: 's-chg-1.s-cnl-1',
      rawStatus: { state: 'REFUNDED' },
    });
  });

  // Nothing is invented as zero: a figure without a reported book value or a succeeded contributing leg
  // is omitted, and a book with no figure at all is omitted entirely - as is an absent vendor orderId.
  it('omits amounts and orderId when the payment reports neither a book nor a contributing leg', () => {
    const details = toPaymentDetails({
      id: 'pay-10',
      state: { name: 'pending' },
      currency: 'EUR',
      transactions: [
        {
          type: 'authorization',
          status: 'error',
          url: 'https://api.unzer.com/v1/payments/pay-10/authorize/aut-1',
          amount: '10.00',
        },
      ],
    });

    expect(details).not.toHaveProperty('amounts');
    expect(details).not.toHaveProperty('orderId');
  });

  // The other two verbatim display lifts run through the same scrub as the leg-kind fallback: a vendor
  // body that puts a card number into the payment state name or the orderId must not hand it to the
  // panel. Digits are counted across the whole string, however the vendor spaced them, so a
  // space-grouped PAN is recognised too; every existing spec above doubles as the below-threshold
  // pass-through proof.
  it('masks a PAN carried in the state name or the orderId - only the last 4 digits survive', () => {
    const details = toPaymentDetails({
      id: 'pay-11',
      state: { name: '4111111111111111' },
      orderId: '4111 1111 1111 1111',
    });

    expect(details.displayStatus).toBe('************1111');
    expect(details.orderId).toBe('**** **** **** 1111');
  });

  // The connector stamps its OWN commercetools payment id into the vendor's `orderId` at charge time,
  // and the panel renders it back. A UUID carries ~22 digits, so the digit-count rule mangled every one
  // of them - the operator read `***d***c-***f-**d*-a**e-d**bb**2612c` where the payment id belonged.
  // A card scheme issues 12-19 CONSECUTIVE digits and none is written in `8-4-4-4-12` hex groups, so
  // the shape exemption gives a PAN nowhere to hide.
  it('leaves a UUID orderId whole - it is the CT payment id, and no PAN is shaped like one', () => {
    const details = toPaymentDetails({
      id: 'pay-12',
      state: { name: 'completed' },
      orderId: '895d830c-870f-41d6-a94e-d31bb402612c',
    });

    expect(details.orderId).toBe('895d830c-870f-41d6-a94e-d31bb402612c');
  });

  // The exemption is the SHAPE and nothing else: a PAN regrouped to look UUID-ish is still masked.
  it('does not let a PAN through by grouping it like a UUID', () => {
    const details = toPaymentDetails({
      id: 'pay-13',
      state: { name: 'completed' },
      orderId: '41111111-1111-1111',
    });

    expect(details.orderId).toBe('********-****-1111');
  });
});

describe('redirectAction', () => {
  it('wraps a URL as a redirect follow-up action', () => {
    expect(redirectAction('https://example.test/3ds')).toEqual({
      kind: 'redirect',
      payload: { url: 'https://example.test/3ds' },
    });
  });

  it('yields `none` when there is no URL', () => {
    expect(redirectAction(undefined)).toEqual({ kind: 'none' });
    expect(redirectAction(null)).toEqual({ kind: 'none' });
    expect(redirectAction('')).toEqual({ kind: 'none' });
  });
});

describe('timingSafeEquals - the fail-closed identity comparison the return leg authenticates with', () => {
  it('matches the exact stamped payment id', () => {
    expect(timingSafeEquals('s-pay-1', 's-pay-1')).toBe(true);
  });

  it('rejects a different value of the same length', () => {
    expect(timingSafeEquals('s-pay-1', 's-pay-2')).toBe(false);
  });

  it('rejects a value of a different length (timingSafeEqual would throw - the guard runs first)', () => {
    expect(timingSafeEquals('s-pay-1', 's-pay-11')).toBe(false);
  });

  it('rejects an absent provided value - the caller fails closed', () => {
    expect(timingSafeEquals('s-pay-1', undefined)).toBe(false);
    expect(timingSafeEquals('s-pay-1', '')).toBe(false);
  });
});

describe('pspCustomFields - the provider-owned CT custom-field carrier', () => {
  it('emits every id that has a value under the psp-payment type', () => {
    const fields = pspCustomFields(
      {
        paymentId: 'pay_000001',
        merchantReference: 'REF000001',
        shopperReturnUrl: 'https://shop.example.test/return',
      },
      'psp-payment',
    );

    expect(fields).toEqual({
      typeKey: 'psp-payment',
      fields: {
        pspPaymentId: 'pay_000001',
        // The webhook reconciliation anchor, stamped at initiation.
        merchantReference: 'REF000001',
        pspShopperReturnUrl: 'https://shop.example.test/return',
      },
    });
  });

  it('omits every absent id - a sparse input never produces empty field values', () => {
    const fields = pspCustomFields({ paymentId: 'pay_000001', merchantReference: null }, 'psp-payment');
    expect(fields.fields).toEqual({ pspPaymentId: 'pay_000001' });
  });

  it('carries the custom-Type key it is handed - the brand value, never a literal of its own', () => {
    expect(pspCustomFields({ paymentId: 'pay_1' }, 'rebranded-payment').typeKey).toBe('rebranded-payment');
  });
});

describe('readStringField - the domain reader over an opaque custom-field map', () => {
  it('reads a non-empty string value', () => {
    expect(readStringField({ pspPaymentId: 'pay_000001' }, 'pspPaymentId')).toBe('pay_000001');
  });

  it('ignores absent, empty and wrong-typed values', () => {
    expect(readStringField({}, 'pspPaymentId')).toBeUndefined();
    expect(readStringField({ pspPaymentId: '' }, 'pspPaymentId')).toBeUndefined();
    expect(readStringField({ pspPaymentId: 42 }, 'pspPaymentId')).toBeUndefined();
  });
});

/**
 * The PAY-BY-TRANSFER answer: Prepayment and Invoice take no money at checkout, they answer with the
 * account the shopper must transfer to. Those values live only on the vendor's `processing` block, so a
 * checkout that drops them leaves the shopper with an order they cannot pay.
 */
describe('transferInstructions', () => {
  it('lifts the account off the processing block as a display action', () => {
    expect(
      transferInstructions({
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
        holder: 'Unzer GmbH',
        descriptor: '4066.7735.0099',
        shortId: '4711.0815.1234',
        uniqueId: 'ignored',
      }),
    ).toEqual({
      kind: 'display',
      payload: {
        instruction: 'bank-transfer',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
        holder: 'Unzer GmbH',
        descriptor: '4066.7735.0099',
        shortId: '4711.0815.1234',
      },
    });
  });

  it('carries only the fields the vendor actually stated', () => {
    expect(transferInstructions({ iban: 'DE89370400440532013000' })).toEqual({
      kind: 'display',
      payload: { instruction: 'bank-transfer', iban: 'DE89370400440532013000' },
    });
  });

  /**
   * No IBAN, no panel. Every method's `processing` block carries bookkeeping of its own (`uniqueId`,
   * `shortId`), and a display action with nothing to display would put an empty box on the thank-you page.
   */
  it.each([
    ['a processing block with no account', { uniqueId: 's-uid-1', shortId: '4711' }],
    ['an empty iban', { iban: '   ' }],
    ['a non-string iban', { iban: 42 }],
    ['no processing block at all', undefined],
  ])('answers nothing for %s', (_case, processing) => {
    expect(transferInstructions(processing as Record<string, unknown> | undefined)).toBeUndefined();
  });
});
