import { describe, expect, it, jest } from '@jest/globals';
import { PaymentState } from '../src/domain';
import type { PayRequest } from '../src/domain';
import { storeConfig } from './support/store-config';
import { PspPaymentHandler } from '../src/providers/psp/payment/payment.handler';
import { PspError } from '../src/providers/psp';
import type { PspClient } from '../src/providers/psp/client';
import type { PspCustomerHandler } from '../src/providers/psp/customer/customer.handler';

const cfg = storeConfig();

/**
 * The shopper path: the browser already tokenized the instrument, so `pay` charges or authorizes the
 * resulting resource id against the Unzer client (a fake here). The client is the seam under test; the
 * mapping (a redirect target to a follow-up action, the custom fields) and the linking of the customer,
 * basket and metadata resources the payment references by id are the handler's own responsibility.
 */
describe('PspPaymentHandler - pay', () => {
  // `bookingMode` is stated rather than left to the per-method default, so the mapping cases below assert
  // the mapping and not the capability table (`card` defaults to `authorize`).
  const baseReq: PayRequest = {
    resourceId: 's-pay-abc',
    paymentMethodCode: 'card',
    amount: { centAmount: 3450, currencyCode: 'EUR' },
    fractionDigits: 2,
    paymentRef: 'order-9',
    returnUrl: 'https://connector.test/return?ctPaymentId=pay-1',
    shopperReturnUrl: 'https://shop.test/return',
    orderId: 'pay-1',
    bookingMode: 'charge',
  };

  /**
   * A fake Unzer client whose charge / authorize return the given payment shape, and whose resource
   * creations return fixed ids. The default charge is a synchronous settled one (real Unzer: `completed`
   * + a succeeded charge leg) - the shape the status interpreter reads; a bare `{ id }` is not a payment
   * Unzer ever returns.
   */
  function fakeClient(over: Partial<Record<'charge' | 'authorize' | 'createBasket' | 'createMetadata', unknown>> = {}) {
    const settled = { id: 's-chg-1', state: { name: 'completed' }, resources: { paymentId: 'unzer-1' } };
    const flat = {
      charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue(settled),
      authorize: jest.fn<PspClient['payments']['authorize']>().mockResolvedValue(settled),
      createBasket: jest.fn<PspClient['baskets']['create']>().mockResolvedValue('s-bsk-55'),
      createMetadata: jest.fn<PspClient['baskets']['createMetadata']>().mockResolvedValue('s-mtd-33'),
      ...over,
    };
    return {
      payments: { charge: flat.charge, authorize: flat.authorize },
      baskets: { create: flat.createBasket, createMetadata: flat.createMetadata },
    } as unknown as Pick<PspClient, 'payments' | 'baskets'>;
  }

  /**
   * A fake customer resolver: the read/create/update decision is `psp-customer.spec.ts`'s subject. The
   * id is a REQUIRED argument - a default here would swallow the `undefined` a cart with no describable
   * shopper resolves to, which is one of the cases this suite has to distinguish.
   */
  function fakeCustomers(customerId: string | undefined) {
    return { resolveCustomerId: jest.fn<PspCustomerHandler['resolveCustomerId']>().mockResolvedValue(customerId) };
  }

  /** The handler under test, with both seams faked. */
  function handler(client = fakeClient(), customers = fakeCustomers('s-cst-77')) {
    return new PspPaymentHandler(client, customers);
  }

  /**
   * A CT Transaction is keyed on the OPERATION's id, never the payment's: a payment holds many
   * operations, and the settling webhook names the one it settled. Keyed on the payment id, a refused
   * authorize wrote a `Failure` leg the webhook could not recognise, and the same refusal was recorded
   * twice - `Authorization / Failed / s-pay-…` beside `Authorization / Failed / s-aut-1`.
   */
  it('names its own operation beside the payment that holds it', async () => {
    const result = await handler().pay(cfg, baseReq);

    expect(result.providerOperationId).toBe('s-chg-1');
    expect(result.providerPaymentId).toBe('unzer-1');
  });

  it('names the authorization when the method books one', async () => {
    const client = fakeClient({
      authorize: jest.fn<PspClient['payments']['authorize']>().mockResolvedValue({
        id: 's-aut-1',
        state: { name: 'pending' },
        resources: { paymentId: 'unzer-1' },
      }),
    });

    const result = await handler(client).pay(cfg, { ...baseReq, bookingMode: 'authorize' });

    expect(result.providerOperationId).toBe('s-aut-1');
  });

  // The core types the leg it records by the kind that was BOOKED, which the method's own support may have
  // overridden; so the answer names the kind that actually went to the vendor, not the one the config asked for.
  it('reports the kind it actually booked', async () => {
    expect((await handler().pay(cfg, baseReq)).bookingMode).toBe('charge');
    expect((await handler().pay(cfg, { ...baseReq, bookingMode: 'authorize' })).bookingMode).toBe('authorize');
    expect(
      (await handler().pay(cfg, { ...baseReq, paymentMethodCode: 'ideal', bookingMode: 'authorize' })).bookingMode,
    ).toBe('charge');
  });

  it('charges via the client and maps a redirectUrl to a redirect follow-up (3DS)', async () => {
    const client = fakeClient({
      charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue({
        id: 's-chg-1',
        state: { name: 'pending' },
        resources: { paymentId: 'unzer-1' },
        redirectUrl: 'https://unzer.test/3ds/unzer-1',
      }),
    });
    const result = await handler(client).pay(cfg, baseReq);

    expect((client.payments.charge as jest.Mock).mock.calls).toHaveLength(1);
    expect((client.payments.authorize as jest.Mock).mock.calls).toHaveLength(0);
    expect(result.providerPaymentId).toBe('unzer-1');
    expect(result.action).toEqual({ kind: 'redirect', payload: { url: 'https://unzer.test/3ds/unzer-1' } });
  });

  // A charge/authorize answers with the TRANSACTION resource: its own `id` is the charge leg's id
  // (`s-chg-1`), and the PAYMENT id - the one every later read uses (`GET /v1/payments/{id}`, the return
  // leg, the webhook fetch-to-verify, the merchant panel) - is `resources.paymentId`. Recording the leg id
  // as the payment id makes each of those reads ask for a resource that does not exist.
  it('records the PAYMENT id from resources, not the charge leg id the response is keyed on', async () => {
    const client = fakeClient({
      charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue({
        id: 's-chg-1',
        state: { name: 'completed' },
        resources: { paymentId: 's-pay-9f8e7d', typeId: 's-crd-1' },
      }),
    });

    const result = await handler(client).pay(cfg, baseReq);

    expect(result.providerPaymentId).toBe('s-pay-9f8e7d');
    expect(result.customFields?.fields.pspPaymentId).toBe('s-pay-9f8e7d');
  });

  // A 2xx that names no payment cannot be recorded: an `undefined` interface id would leave a charged
  // payment that no read, webhook or refund could ever find.
  it('fails closed when the vendor answers a charge with no payment id', async () => {
    const client = fakeClient({
      charge: jest
        .fn<PspClient['payments']['charge']>()
        .mockResolvedValue({ id: 's-chg-1', state: { name: 'completed' } }),
    });

    await expect(handler(client).pay(cfg, baseReq)).rejects.toBeInstanceOf(PspError);
  });

  it('a synchronous charge (no redirectUrl) resolves to a none follow-up', async () => {
    const client = fakeClient({
      charge: jest
        .fn<PspClient['payments']['charge']>()
        .mockResolvedValue({ id: 's-chg-2', state: { name: 'completed' }, resources: { paymentId: 'unzer-2' } }),
    });
    const result = await handler(client).pay(cfg, baseReq);

    expect(result.action).toEqual({ kind: 'none' });
  });

  /**
   * A PAY-BY-TRANSFER answer: no redirect, no settlement - the account the shopper must transfer to,
   * which the charge lifts out of the vendor's `processing` block so the checkout can show it. Prepayment and
   * Invoice are unpayable without it.
   */
  it('a pay-by-transfer charge resolves to a display follow-up carrying the account', async () => {
    const client = fakeClient({
      charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue({
        id: 's-chg-3',
        resources: { paymentId: 'unzer-3' },
        isPending: true,
        processing: {
          iban: 'DE89370400440532013000',
          bic: 'COBADEFFXXX',
          holder: 'Unzer GmbH',
          descriptor: '4066.7735.0099',
        },
      }),
    });

    const result = await handler(client).pay(cfg, { ...baseReq, paymentMethodCode: 'prepayment' });

    expect(result.action).toEqual({
      kind: 'display',
      payload: {
        instruction: 'bank-transfer',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
        holder: 'Unzer GmbH',
        descriptor: '4066.7735.0099',
      },
    });
  });

  /**
   * The gate is the METHOD, not the presence of an iban: the vendor puts one in `processing` for the SEPA
   * mandate as well, and a direct debit has already collected the money - a transfer panel there would tell the
   * shopper to pay twice.
   */
  it.each(['sepa-direct-debit', 'card', 'paylater-invoice'])(
    'settles %s in place even when the answer carries an account',
    async (paymentMethodCode) => {
      const client = fakeClient({
        charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue({
          id: 's-chg-5',
          // A charge that SETTLED: the transaction resource states its verdict in the triple, since it
          // carries no `state` of its own. Without it the answer is uninterpretable, which is a different
          // failure from the one this case is about.
          isSuccess: true,
          resources: { paymentId: 'unzer-5' },
          processing: { iban: 'DE89370400440532013000', descriptor: '4066.7735.0099' },
        }),
      });

      const result = await handler(client).pay(cfg, { ...baseReq, paymentMethodCode });

      expect(result.action).toEqual({ kind: 'none' });
    },
  );

  // A redirect method whose answer happens to carry a processing block is still a REDIRECT: the shopper is sent
  // to the vendor, and there is nothing to read off a page they are leaving.
  it('prefers the redirect over an account in the same answer', async () => {
    const client = fakeClient({
      charge: jest.fn<PspClient['payments']['charge']>().mockResolvedValue({
        id: 's-chg-4',
        resources: { paymentId: 'unzer-4' },
        redirectUrl: 'https://unzer.test/3ds/unzer-4',
        processing: { iban: 'DE89370400440532013000' },
      }),
    });

    const result = await handler(client).pay(cfg, baseReq);

    expect(result.action).toMatchObject({ kind: 'redirect' });
  });

  it('picks the vendor authorize endpoint when the method books as authorize', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, { ...baseReq, bookingMode: 'authorize' });

    expect((client.payments.authorize as jest.Mock).mock.calls).toHaveLength(1);
    expect((client.payments.charge as jest.Mock).mock.calls).toHaveLength(0);
  });

  /**
   * The kind booked is the method's CAPABILITY first and the merchant's choice second. Klarna
   * and the paylater family refuse a direct charge - the live sandbox answers `500 API.000.000.999` - so a
   * stored `charge` cannot be honoured: honouring it refuses the payment, which is how Klarna failed at a
   * shopper's checkout. The reverse holds for the redirect family, which answers `405 API.320.000.004` to
   * an authorization.
   */
  it('authorizes an authorize-only method even when the config says charge', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, { ...baseReq, paymentMethodCode: 'klarna', bookingMode: 'charge' });

    expect((client.payments.authorize as jest.Mock).mock.calls).toHaveLength(1);
    expect((client.payments.charge as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('charges a charge-only method even when the config says authorize', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, { ...baseReq, paymentMethodCode: 'ideal', bookingMode: 'authorize' });

    expect((client.payments.charge as jest.Mock).mock.calls).toHaveLength(1);
    expect((client.payments.authorize as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('falls back to the per-method default when the merchant configured no booking mode', async () => {
    const cardClient = fakeClient();
    await handler(cardClient).pay(cfg, { ...baseReq, paymentMethodCode: 'card', bookingMode: undefined });
    expect((cardClient.payments.authorize as jest.Mock).mock.calls).toHaveLength(1);

    const walletClient = fakeClient();
    await handler(walletClient).pay(cfg, { ...baseReq, paymentMethodCode: 'googlepay', bookingMode: undefined });
    expect((walletClient.payments.charge as jest.Mock).mock.calls).toHaveLength(1);
  });

  /**
   * The status interpretation must read the EFFECTIVE kind, not the configured one: a redirect answer means
   * `AUTHORIZATION_REQUESTED` after an authorization and `REDIRECTED` after a charge, and the CT transaction
   * type follows from it. Interpreting a forced Klarna authorization as a charge would record the money as
   * captured when it is only reserved.
   */
  it('interprets the vendor answer by the kind actually booked, not the kind configured', async () => {
    // A `pending` payment with NO redirect is where the booked kind decides the reading: an authorization
    // is AWAITING one (`AUTHORIZATION_REQUESTED`), a charge is mid-redirect. Reading a forced Klarna
    // authorization as a charge would describe reserved money as a redirect that never happened.
    const pending = { id: 's-aut-1', state: { name: 'pending' }, resources: { paymentId: 'unzer-9' } };
    const client = fakeClient({ authorize: jest.fn<PspClient['payments']['authorize']>().mockResolvedValue(pending) });

    const result = await handler(client).pay(cfg, {
      ...baseReq,
      paymentMethodCode: 'klarna',
      bookingMode: 'charge',
    });

    expect(result.rawStatus).toMatchObject({ state: PaymentState.AUTHORIZATION_REQUESTED });
  });

  // A server-assembled basket becomes its OWN vendor resource and the charge links only its id: the
  // vendor's payment request has no basket field, so an embedded basket would be discarded in silence.
  it('creates the basket resource and links it by id', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, {
      ...baseReq,
      basket: [
        {
          title: 'Widget',
          quantity: 2,
          amountPerUnitGross: 1725,
          amountDiscountPerUnitGross: 0,
          vat: 19,
          type: 'goods',
        },
      ],
    });

    expect((client.baskets.create as jest.Mock).mock.calls[0]![1]).toEqual({
      totalValueGross: '34.50',
      currencyCode: 'EUR',
      orderId: 'pay-1',
      basketItems: [
        {
          basketItemReferenceId: 'line-0',
          title: 'Widget',
          quantity: 2,
          amountPerUnitGross: '17.25',
          amountDiscountPerUnitGross: '0.00',
          vat: 19,
          type: 'goods',
        },
      ],
    });
    const input = (client.payments.charge as jest.Mock).mock.calls[0]![1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('basket');
    expect(input.basketId).toBe('s-bsk-55');
  });

  it('creates no basket resource and links no basket id when the caller passed no lines', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, baseReq);

    expect((client.baskets.create as jest.Mock).mock.calls).toHaveLength(0);
    expect((client.payments.charge as jest.Mock).mock.calls[0]![1]).not.toHaveProperty('basketId');
  });

  it('creates the metadata resource identifying the connector and links it by id', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, baseReq);

    expect((client.baskets.createMetadata as jest.Mock).mock.calls[0]![1]).toMatchObject({ shopType: 'commercetools' });
    expect((client.payments.charge as jest.Mock).mock.calls[0]![1]).toMatchObject({ metadataId: 's-mtd-33' });
  });

  /**
   * `toUnzerMetadata` derives its whole body from `StoreConfig.connector` / `.integrator` - deployment
   * constants with no per-payment input - so a metadata resource per payment sends a byte-identical
   * `POST /v1/metadata` on every charge and mints a vendor resource that persists. One shared handler
   * instance serves every payment (`buildPspModule`), so the id is memoized per `(storeKey, mode)`: the
   * pair that selects the vendor account the resource lives in.
   */
  it('creates ONE metadata resource for repeated charges under one store config and links it to both', async () => {
    const client = fakeClient();
    const shared = handler(client);

    await shared.pay(cfg, baseReq);
    await shared.pay(cfg, baseReq);

    expect((client.baskets.createMetadata as jest.Mock).mock.calls).toHaveLength(1);
    expect((client.payments.charge as jest.Mock).mock.calls[0]![1]).toMatchObject({ metadataId: 's-mtd-33' });
    expect((client.payments.charge as jest.Mock).mock.calls[1]![1]).toMatchObject({ metadataId: 's-mtd-33' });
  });

  /**
   * The memo's effect stated as the quantity it changes: vendor round trips per charge. A charge that sends
   * basket lines to a brand-new customer costs 4 - `POST /v1/customers`, `POST /v1/metadata`,
   * `POST /v2/baskets`, `POST /v1/payments/charges` - the first time in the window and 3 every later time.
   */
  it('costs 4 vendor calls for the first charge in the memo window and 3 for the next', async () => {
    const client = fakeClient();
    const customers = fakeCustomers('s-cst-77');
    const shared = new PspPaymentHandler(client, customers);
    const withLines: PayRequest = {
      ...baseReq,
      basket: [
        {
          title: 'Widget',
          quantity: 2,
          amountPerUnitGross: 1725,
          amountDiscountPerUnitGross: 0,
          vat: 19,
          type: 'goods',
        },
      ],
    };
    const vendorCalls = (): number =>
      customers.resolveCustomerId.mock.calls.length +
      (client.baskets.createMetadata as jest.Mock).mock.calls.length +
      (client.baskets.create as jest.Mock).mock.calls.length +
      (client.payments.charge as jest.Mock).mock.calls.length;

    await shared.pay(cfg, withLines);
    const firstCharge = vendorCalls();
    await shared.pay(cfg, withLines);

    expect(firstCharge).toBe(4);
    expect(vendorCalls() - firstCharge).toBe(3);
  });

  // A metadata id is valid only at the vendor account the store's credentials address, so neither another
  // store nor the other environment of the same store may be served the memoized one.
  it('mints a separate metadata resource per store key and per mode', async () => {
    const client = fakeClient();
    const shared = handler(client);

    await shared.pay(cfg, baseReq);
    await shared.pay(storeConfig({ storeKey: 'second' }), baseReq);
    await shared.pay(storeConfig({ mode: 'live' }), baseReq);

    expect((client.baskets.createMetadata as jest.Mock).mock.calls).toHaveLength(3);
  });

  it('links the customer id the resolver produced, and none when it produced none', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, baseReq);
    expect((client.payments.charge as jest.Mock).mock.calls[0]![1]).toMatchObject({ customerId: 's-cst-77' });

    const guestClient = fakeClient();
    await handler(guestClient, fakeCustomers(undefined)).pay(cfg, baseReq);
    expect((guestClient.payments.charge as jest.Mock).mock.calls[0]![1]).not.toHaveProperty('customerId');
  });

  // The shopper data the resolver needs comes off the charge request; the PLATFORM customer id travels
  // as `shopperRef` and must never reach the vendor as its own customer id. This request carries no
  // `candidateCustomerId`, so the resolver maps the payer from the cart.
  it('hands the resolver the platform reference and the cart shopper data', async () => {
    const customers = fakeCustomers('s-cst-77');
    await handler(fakeClient(), customers).pay(cfg, {
      ...baseReq,
      shopperRef: 'ct-cust-9',
      shopper: { email: 'peter@example.com', firstName: 'Peter', lastName: 'Universum' },
      billingAddress: { city: 'Heidelberg' },
      locale: 'de-DE',
    });

    expect(customers.resolveCustomerId.mock.calls[0]![1]).toEqual({
      shopperRef: 'ct-cust-9',
      shopper: { email: 'peter@example.com', firstName: 'Peter', lastName: 'Universum' },
      billingAddress: { city: 'Heidelberg' },
      locale: 'de-DE',
    });
  });

  it('maps the device fingerprint onto the vendor risk data', async () => {
    const client = fakeClient();
    await handler(client).pay(cfg, { ...baseReq, deviceFingerprintId: 'tmx-9f1c' });

    expect((client.payments.charge as jest.Mock).mock.calls[0]![1]).toMatchObject({
      threatMetrixId: 'tmx-9f1c',
    });
  });

  // Every preparatory call has to precede the money call: a basket or customer failure must refuse the
  // payment with nothing charged, never leave a charge whose linked resources are missing.
  it('creates every linked resource BEFORE the charge, and does not charge when one fails', async () => {
    const client = fakeClient({
      createBasket: jest.fn<PspClient['baskets']['create']>().mockRejectedValue(new Error('basket refused')),
    });

    await expect(
      handler(client).pay(cfg, {
        ...baseReq,
        basket: [
          {
            title: 'Widget',
            quantity: 1,
            amountPerUnitGross: 3450,
            amountDiscountPerUnitGross: 0,
            vat: 0,
            type: 'goods',
          },
        ],
      }),
    ).rejects.toThrow('basket refused');

    expect((client.payments.charge as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('stamps paymentId + merchantReference + shopperReturnUrl on the provider custom fields', async () => {
    const result = await handler().pay(cfg, baseReq);

    expect(result.customFields).toEqual({
      typeKey: 'psp-payment',
      fields: {
        pspPaymentId: 'unzer-1',
        merchantReference: 'order-9',
        pspShopperReturnUrl: 'https://shop.test/return',
      },
    });
  });
});
