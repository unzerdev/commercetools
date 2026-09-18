/**
 * `createPayment` (flat charge path) — dispatch + surcharge + basket gate + state-machine wiring,
 * exercised with fake ports + a fake provider (no concrete provider, no live commercetools).
 *
 * The browser has already tokenized the instrument and sends a `resourceId`; the server resolves the
 * method's surcharge / basket / booking behavior from the payment-methods Custom Object, is the sole
 * authority on the charged amount (cart total + surcharge), assembles the basket itself, and charges
 * the resource id through `AuthorizationHandler.charge`.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ErrorGeneral, Errorx } from '@commercetools/connect-payments-sdk';
import type { PaymentMethodConfig, PaymentRequest } from '../src/domain';
import { PaymentState } from '../src/domain';
import type { CorePorts } from '../src/application/ports';
import { createPayment, SHOPPER_PAYMENT_FAILURE_MESSAGE } from '../src/application/orchestration';
import { PspError } from '../src/providers/psp';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

/**
 * Configure the store's payment-methods Custom Object with an enabled method for the resolved (sandbox)
 * environment. A createPayment now REFUSES a code that is not present-and-enabled (N2), so every charge
 * path must first enable the method it charges.
 */
function withEnabledMethod(
  ports: CorePorts,
  method: Partial<PaymentMethodConfig> & { paymentMethodCode: string } = { paymentMethodCode: 'card' },
) {
  ports.paymentMethodsStore.readWithVersion = jest
    .fn<CorePorts['paymentMethodsStore']['readWithVersion']>()
    .mockResolvedValue({
      value: {
        store: 'store-1',
        environments: {
          sandbox: {
            paymentMethods: [
              {
                enabled: true,
                name: {},
                description: {},
                countries: [],
                sendBasketData: false,
                ...method,
              },
            ],
          },
        },
      },
      version: 1,
    } as never);
}

describe('orchestration/createPayment', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  /** A fresh-payment request body (the flat contract): a method code + the browser resource id. */
  const data = (over: Record<string, unknown> = {}) => ({
    paymentMethodCode: 'card',
    resourceId: 's-pay-1',
    returnUrl: 'https://shop.test/return',
    ...over,
  });

  /** The request argument the charge seam was called with. */
  const chargeArg = (): Record<string, unknown> =>
    ((provider.payment.pay as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];

  /** Configure the store's payment-methods Custom Object for the resolved (sandbox) environment. */
  function withMethod(method: Partial<PaymentMethodConfig> & { paymentMethodCode: string }) {
    withEnabledMethod(ports, method);
  }

  /** Point the cart reader at a cart carrying one line item (for basket assembly). */
  function cartWithItems(over: Record<string, unknown> = {}) {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
      lineItems: [
        {
          name: { en: 'Widget' },
          quantity: 2,
          price: { value: { centAmount: 750, currencyCode: 'EUR' } },
          taxRate: { amount: 0.19 },
          totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
        },
      ],
      ...over,
    } as never);
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    withEnabledMethod(ports);
  });

  /** The CT `PaymentDraft` the create seam was called with. */
  const createArg = (): Record<string, any> =>
    ((ports.paymentStore.create as jest.Mock).mock.calls[0] as [Record<string, any>])[0];

  /**
   * What the Merchant Center's Payment page reads under "Payment method" and "Payment method name".
   * Both are known at create time — the method code is what the shopper chose and the name is what the
   * merchant typed for it in the mc app — so writing them costs no call and no later update. The panel's
   * own `paymentMethod` column reads the same `method` (`order-payments.ts`).
   */
  test('the CT Payment names the chosen method and carries the merchant own localized name for it', async () => {
    withMethod({ paymentMethodCode: 'paylater-invoice', name: { en: 'Invoice', de: 'Rechnung' } });

    await createPayment({ env, data: data({ paymentMethodCode: 'paylater-invoice' }) }, { ports, provider });

    expect(createArg().paymentMethodInfo).toEqual({
      paymentInterface: 'psp',
      method: 'paylater-invoice',
      name: { en: 'Invoice', de: 'Rechnung' },
    });
  });

  // A merchant who typed no name has none, and an empty localized bag is not a name: commercetools would
  // hold `{}` and the page would render an empty label rather than falling back to the method code.
  test('a method the merchant named in no language omits the name rather than writing an empty bag', async () => {
    withMethod({ paymentMethodCode: 'card', name: {} });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(createArg().paymentMethodInfo).toEqual({ paymentInterface: 'psp', method: 'card' });
  });

  test('surcharge: the charged amount is the cart total plus the method surcharge, in minor units', async () => {
    withMethod({ paymentMethodCode: 'card', surcharge: { EUR: 150 } });

    await createPayment({ env, data: data() }, { ports, provider });

    // 1500 (cart) + 150 (surcharge) = 1650 — integer minor units, no float.
    expect(chargeArg()).toMatchObject({ amount: { centAmount: 1650, currencyCode: 'EUR' } });
    // The CT Payment is planned for the surcharged amount too.
    expect(ports.paymentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountPlanned: expect.objectContaining({ centAmount: 1650 }) }),
    );
  });

  // The surcharge is resolved FOR THE CART'S CURRENCY. A figure entered for another currency is not this
  // cart's, and charging it would take money in a scale the merchant never priced.
  test('a surcharge configured for another currency adds nothing to the charged amount', async () => {
    withMethod({ paymentMethodCode: 'card', surcharge: { USD: 150 } });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg()).toMatchObject({ amount: { centAmount: 1500, currencyCode: 'EUR' } });
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: expect.objectContaining({ fields: expect.objectContaining({ pspSurcharge: '0' }) }),
      }),
    );
  });

  test('the surcharge for the cart currency is the one charged, among several configured', async () => {
    withMethod({
      paymentMethodCode: 'card',
      surcharge: { USD: 999, EUR: 150, JPY: 500 },
    });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg()).toMatchObject({ amount: { centAmount: 1650, currencyCode: 'EUR' } });
  });

  test('surcharge is recorded on the pspSurcharge custom field (R4 auditability)', async () => {
    withMethod({ paymentMethodCode: 'card', surcharge: { EUR: 150 } });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: expect.objectContaining({ fields: expect.objectContaining({ pspSurcharge: '150' }) }),
      }),
    );
  });

  test('no surcharge configured: the bare cart amount is charged and a zero surcharge is recorded', async () => {
    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg()).toMatchObject({ amount: { centAmount: 1500, currencyCode: 'EUR' } });
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: expect.objectContaining({ fields: expect.objectContaining({ pspSurcharge: '0' }) }),
      }),
    );
  });

  test('basket gate ON: the server-assembled basket from the cart reaches the charge; the browser sent none', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card', sendBasketData: true });

    await createPayment({ env, data: data() }, { ports, provider });

    // The browser body (the flat DTO) carries no basket at all — the server is the sole source.
    expect(data()).not.toHaveProperty('basket');
    // The basket is assembled from the cart line items, not from the request.
    // `vat` is the PERCENT the vendor expects (the cart carries the fraction 0.19), and every line
    // carries both amount members because the vendor sums the basket arithmetically.
    expect(chargeArg().basket).toEqual([
      { title: 'Widget', quantity: 2, amountPerUnitGross: 750, amountDiscountPerUnitGross: 0, vat: 19, type: 'goods' },
    ]);
  });

  /**
   * The vendor validates the basket against the CHARGED amount, which is the cart total plus the method
   * surcharge. The surcharge belongs to no cart line, so it needs a line of its own or the basket is
   * short by exactly it and the charge is refused.
   *
   * That line is NAMED. It used to be the anonymous "Rounding Adjustment", which balanced the
   * arithmetic while telling a shopper reading a buy-now-pay-later contract nothing about what the extra
   * money was for.
   */
  test('basket gate ON with a surcharge: the surcharge is its own named line', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card', sendBasketData: true, surcharge: { EUR: 150 } });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg().basket).toEqual([
      { title: 'Widget', quantity: 2, amountPerUnitGross: 750, amountDiscountPerUnitGross: 0, vat: 19, type: 'goods' },
      {
        title: 'Payment surcharge',
        quantity: 1,
        amountPerUnitGross: 150,
        amountDiscountPerUnitGross: 0,
        vat: 0,
        type: 'goods',
      },
    ]);
    // No rounding line: the surcharge line already balances the basket against the charged amount.
    expect(chargeArg().basket).toHaveLength(2);
    expect(chargeArg().amount).toMatchObject({ centAmount: 1650 });
  });

  // The PLATFORM's customer id is not the vendor's. It travels as `shopperRef`, from which the provider
  // composes its own merchant-side reference; sending it as the vendor customer id refuses the charge.
  test('the platform customer id travels as shopperRef, never as a provider customer id', async () => {
    cartWithItems({ customerId: 'ct-cust-9' });
    withMethod({ paymentMethodCode: 'card' });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg().shopperRef).toBe('ct-cust-9');
    expect(chargeArg()).not.toHaveProperty('customerRef');
    expect(chargeArg()).not.toHaveProperty('providerCustomerId');
  });

  // The browser sends the device fingerprint and NOTHING about the customer: resolving the vendor customer
  // is the processor's own work, done from the session cart.
  test('a device fingerprint from the browser reaches the charge, and no customer id can', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card' });

    await createPayment({ env, data: data({ deviceFingerprintId: 'tmx-9f1c' }) }, { ports, provider });

    expect(chargeArg()).toMatchObject({ deviceFingerprintId: 'tmx-9f1c' });
    expect(chargeArg()).not.toHaveProperty('providerCustomerId');
  });

  /**
   * The shopper's DATE OF BIRTH. Buy-now-pay-later methods are refused without it — `paylater-invoice`
   * answers `COR.100.301.112` "Missing element 'Transaction/Customer/Name/Birthdate'" — and a
   * commercetools CART carries no such field, so it has exactly two possible sources, the same two the
   * reference integration uses: the value the checkout surface collected (the vendor's own paylater form
   * collects one) and the signed-in shopper's commercetools Customer profile. The request wins where both
   * exist, because it describes THIS purchase while the profile may be stale.
   */
  test('a date of birth from the request reaches the charge as the shopper date of birth', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card' });

    await createPayment({ env, data: data({ collectedCustomer: { dateOfBirth: '19850409' } }) }, { ports, provider });

    expect(chargeArg().shopper).toMatchObject({ dateOfBirth: '19850409' });
  });

  test('falls back to the commercetools customer profile when the request carries none', async () => {
    cartWithItems({ customerId: 'cust-77' });
    withMethod({ paymentMethodCode: 'card' });
    ports.customerReader.dateOfBirth = jest.fn<typeof ports.customerReader.dateOfBirth>().mockResolvedValue('19700101');

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.customerReader.dateOfBirth).toHaveBeenCalledWith('cust-77');
    expect(chargeArg().shopper).toMatchObject({ dateOfBirth: '19700101' });
  });

  // The request describes the purchase in front of the shopper; the profile is whatever was saved once. So
  // the profile is not even read when the request already carries the value — one fewer platform call, and
  // no chance of the stale value winning.
  test('does not read the customer profile when the request carries a date of birth', async () => {
    cartWithItems({ customerId: 'cust-77' });
    withMethod({ paymentMethodCode: 'card' });
    ports.customerReader.dateOfBirth = jest.fn<typeof ports.customerReader.dateOfBirth>().mockResolvedValue('19700101');

    await createPayment({ env, data: data({ collectedCustomer: { dateOfBirth: '19850409' } }) }, { ports, provider });

    expect(ports.customerReader.dateOfBirth).not.toHaveBeenCalled();
    expect(chargeArg().shopper).toMatchObject({ dateOfBirth: '19850409' });
  });

  // A guest cart names no platform customer, so there is nothing to read: the request is the only source,
  // and its absence must not cost a call that would 404 anyway.
  test('reads no customer profile for a guest cart', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card' });
    ports.customerReader.dateOfBirth = jest.fn<typeof ports.customerReader.dateOfBirth>();

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.customerReader.dateOfBirth).not.toHaveBeenCalled();
    expect(chargeArg().shopper ?? {}).not.toHaveProperty('dateOfBirth');
  });

  /**
   * A GUEST cart names nobody: no email, no address, no profile to read. Everything the vendor needs about
   * the payer then comes from the form the shopper filled in, which is what makes a buy-now-pay-later payment
   * possible without an account. The collected values fill the cart's gaps — they never overwrite it.
   */
  test('a guest cart takes the name, contact and address from the collected customer', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
      lineItems: [],
    } as never);
    withMethod({ paymentMethodCode: 'card' });

    await createPayment(
      {
        env,
        data: data({
          collectedCustomer: {
            firstName: 'Max',
            lastName: 'Mustermann',
            email: 'max@example.com',
            dateOfBirth: '19850409',
            billingAddress: { street: 'Hugo-Junkers-Str.', houseNumber: '5', postalCode: '60386', city: 'Frankfurt' },
          },
        }),
      },
      { ports, provider },
    );

    expect(chargeArg().shopper).toMatchObject({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.com',
      dateOfBirth: '19850409',
    });
    expect(chargeArg().billingAddress).toMatchObject({
      street: 'Hugo-Junkers-Str.',
      houseNumber: '5',
      postalCode: '60386',
      city: 'Frankfurt',
    });
  });

  // The CART is what the merchant invoices and ships against, so a browser cannot rewrite it: where the cart
  // has an address, the collected one is ignored entirely.
  test('the cart address wins over the collected one', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
      lineItems: [],
      customerEmail: 'from-cart@example.com',
      billingAddress: { firstName: 'Cart', lastName: 'Owner', streetName: 'Cartstr', city: 'Berlin', country: 'DE' },
    } as never);
    withMethod({ paymentMethodCode: 'card' });

    await createPayment(
      {
        env,
        data: data({
          collectedCustomer: {
            firstName: 'Typed',
            lastName: 'Shopper',
            email: 'typed@example.com',
            billingAddress: { street: 'Typedstr', city: 'Munich', countryCode: 'AT' },
          },
        }),
      },
      { ports, provider },
    );

    expect(chargeArg().shopper).toMatchObject({
      firstName: 'Cart',
      lastName: 'Owner',
      email: 'from-cart@example.com',
    });
    expect(chargeArg().billingAddress).toMatchObject({ street: 'Cartstr', city: 'Berlin', countryCode: 'DE' });
  });

  // The salutation follows the same rule one level down: the billing address carries it when the platform
  // has one, and the checkout surface's value is the fallback (the reference reads the payment's own
  // `salutation` last, for exactly the methods that require it).
  test('a salutation from the request reaches the charge when the address carries none', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card' });

    await createPayment({ env, data: data({ collectedCustomer: { salutation: 'mrs' } }) }, { ports, provider });

    expect(chargeArg().shopper).toMatchObject({ salutation: 'mrs' });
  });

  test('basket gate OFF: no basket is sent when the method flag is false', async () => {
    cartWithItems();
    withMethod({ paymentMethodCode: 'card', sendBasketData: false });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg()).not.toHaveProperty('basket');
  });

  test('3DS/redirect: the charge redirect action flows back to the caller', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REDIRECTED);
    provider.payment.pay = jest.fn<typeof provider.payment.pay>().mockResolvedValue({
      providerPaymentId: 'unzer-1',
      bookingMode: 'charge',
      action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds/unzer-1' } },
      rawStatus: { state: 'pending' },
      customFields: { typeKey: 'psp-payment', fields: { pspPaymentId: 'unzer-1' } },
    });

    const result = await createPayment({ env, data: data() }, { ports, provider });

    expect(result).toStrictEqual({
      paymentReference: 'pay-1',
      action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds/unzer-1' } },
    });
  });

  /**
   * An operation the vendor accepted but has not settled (a redirect ahead, a bank transfer awaited) is recorded
   * as a `Pending` leg of the kind that was booked, keyed on the vendor's operation id. A host that verifies the
   * payment right after the create call (commercetools Checkout does, before it creates the order) finds the
   * opened operation; the return leg and the webhook later move that same leg, because they key their write on
   * the same id.
   */
  describe('the opened operation is recorded as a Pending leg', () => {
    const openAnswer = (over: Record<string, unknown> = {}) => ({
      providerPaymentId: 'unzer-1',
      providerOperationId: 's-chg-1',
      bookingMode: 'charge' as const,
      action: { kind: 'none' as const },
      rawStatus: { state: 'pending' },
      ...over,
    });

    const vendorAnswers = (state: PaymentState, over: Record<string, unknown> = {}): void => {
      provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(state);
      provider.payment.pay = jest.fn<typeof provider.payment.pay>().mockResolvedValue(openAnswer(over) as never);
    };

    /** The transaction the one `update` of the create leg carried. */
    const writtenLeg = (): Record<string, unknown> | undefined =>
      ((ports.paymentStore.update as jest.Mock).mock.calls[0] as [Record<string, any>])[0].transaction;

    test('prepayment: CAPTURE_REQUESTED writes Charge:Pending keyed on the vendor charge id', async () => {
      // The one test in this block that names a method other than the `beforeEach` default, so it enables
      // that method too: `resolveMethodConfig` refuses a code the store's effective list does not carry.
      withEnabledMethod(ports, { paymentMethodCode: 'prepayment' });
      vendorAnswers(PaymentState.CAPTURE_REQUESTED, { action: { kind: 'display', payload: { iban: 'DE02' } } });

      await createPayment({ env, data: data({ paymentMethodCode: 'prepayment' }) }, { ports, provider });

      expect(ports.paymentStore.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pay-1', pspReference: 'unzer-1' }),
      );
      expect(writtenLeg()).toEqual({
        type: 'Charge',
        state: 'Pending',
        amount: expect.objectContaining({ centAmount: 1500, currencyCode: 'EUR' }),
        interactionId: 's-chg-1',
      });
    });

    test('3DS under a charge booking: REDIRECTED writes Charge:Pending', async () => {
      vendorAnswers(PaymentState.REDIRECTED, {
        action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds/unzer-1' } },
      });

      await createPayment({ env, data: data() }, { ports, provider });

      expect(writtenLeg()).toMatchObject({ type: 'Charge', state: 'Pending', interactionId: 's-chg-1' });
    });

    test('3DS under an authorize booking: REDIRECTED writes Authorization:Pending keyed on the authorization', async () => {
      vendorAnswers(PaymentState.REDIRECTED, {
        providerOperationId: 's-aut-1',
        bookingMode: 'authorize',
        action: { kind: 'redirect', payload: { url: 'https://unzer.test/3ds/unzer-1' } },
      });

      await createPayment({ env, data: data() }, { ports, provider });

      expect(writtenLeg()).toMatchObject({ type: 'Authorization', state: 'Pending', interactionId: 's-aut-1' });
    });

    test('a vendor naming no operation keys the Pending leg on the payment id', async () => {
      vendorAnswers(PaymentState.CAPTURE_REQUESTED, { providerOperationId: undefined });

      await createPayment({ env, data: data() }, { ports, provider });

      expect(writtenLeg()).toMatchObject({ type: 'Charge', state: 'Pending', interactionId: 'unzer-1' });
    });

    test('a settled charge still writes Charge:Success, nothing Pending', async () => {
      vendorAnswers(PaymentState.CAPTURED, { rawStatus: { state: 'CAPTURED' } });

      await createPayment({ env, data: data() }, { ports, provider });

      expect(writtenLeg()).toMatchObject({ type: 'Charge', state: 'Success', interactionId: 's-chg-1' });
    });

    test('a refused charge still writes Authorization:Failure, as the table has it', async () => {
      vendorAnswers(PaymentState.FAILED, { rawStatus: { state: 'FAILED' } });

      await createPayment({ env, data: data() }, { ports, provider });

      expect(writtenLeg()).toMatchObject({ type: 'Authorization', state: 'Failure' });
    });
  });

  test('synchronous success: the charge is invoked once and the CT Payment id is returned with a none action', async () => {
    const result = await createPayment({ env, data: data() }, { ports, provider });

    expect((provider.payment.pay as jest.Mock).mock.calls).toHaveLength(1);
    expect(chargeArg()).toMatchObject({
      resourceId: 's-pay-1',
      orderId: 'pay-1',
      shopperReturnUrl: 'https://shop.test/return',
    });
    expect(result).toStrictEqual({ paymentReference: 'pay-1', action: { kind: 'none' } });
  });

  /**
   * The status write is the LAST act of the create path and the only thing that fills the page's PSP Status
   * Code and Payment state. Asserted here at the orchestration level, not only on the helper: the
   * helper's own spec passes with all four call sites deleted, and the two fields then silently read `-`.
   */
  test('the vendor status code, its text and the payment state are written from the charge answer', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    provider.payment.pay = jest.fn<typeof provider.payment.pay>().mockResolvedValue({
      providerPaymentId: 'vendor-charge-1',
      bookingMode: 'charge',
      action: { kind: 'none' },
      rawStatus: { state: 'CAPTURED' },
      statusCode: { code: 'COR.000.100.112', text: 'Your payment has been processed.' },
    });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.000.100.112',
      interfaceText: 'Your payment has been processed.',
      stateKey: 'completed',
    });
  });

  /**
   * A synchronous charge the vendor holds for review reaches `IN_REVIEW`, which maps to `Authorization:
   * Pending` plus the review flag. The create path is the one path a webhook cannot repair afterwards: no
   * subscribed event carries `IN_REVIEW`, so a create that skipped the flag left the panel reading
   * `inReview: false` for a payment the vendor was still deciding on, permanently.
   */
  test('a charge the vendor holds for review writes the review flag, not only the transaction', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.IN_REVIEW);
    provider.payment.pay = jest.fn<typeof provider.payment.pay>().mockResolvedValue({
      providerPaymentId: 'vendor-charge-1',
      bookingMode: 'charge',
      action: { kind: 'none' },
      rawStatus: { state: 'IN_REVIEW' },
    });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.paymentStore.setReviewFlag).toHaveBeenCalledWith('pay-1');
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.objectContaining({ type: 'Authorization', state: 'Pending' }) }),
    );
  });

  // The flag is written BEFORE the transaction: a crash between the two leaves a payment flagged for review
  // with no leg, which an operator reads as "look at this", while the reverse order leaves a settled-looking
  // payment nobody is told to look at.
  test('the review flag is written before the transaction it belongs to', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.IN_REVIEW);

    await createPayment({ env, data: data() }, { ports, provider });

    const flagOrder = (ports.paymentStore.setReviewFlag as jest.Mock).mock.invocationCallOrder[0] as number;
    const updateOrder = (ports.paymentStore.update as jest.Mock).mock.invocationCallOrder[0] as number;
    expect(flagOrder).toBeLessThan(updateOrder);
  });

  // Every other outcome leaves the flag alone: writing `false` on a payment nothing reviewed would clear a
  // flag an earlier operation set.
  test('a settled charge writes no review flag at all', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.paymentStore.setReviewFlag).not.toHaveBeenCalled();
  });

  test('bookingMode is threaded from the method config', async () => {
    withMethod({ paymentMethodCode: 'card', bookingMode: 'authorize' });

    await createPayment({ env, data: data() }, { ports, provider });

    expect(chargeArg()).toMatchObject({ bookingMode: 'authorize' });
  });

  // The browser's tokenized resource is the ONLY thing a charge can be booked against, so a request
  // without one is refused at intake — before a CT Payment exists and before the vendor is called.
  test('a request carrying no resourceId is refused before any CT Payment or charge', async () => {
    await expect(
      createPayment(
        { env, data: { paymentMethodCode: 'card', returnUrl: 'https://shop.test/return' } as PaymentRequest },
        {
          ports,
          provider,
        },
      ),
    ).rejects.toThrow(/must carry a resourceId/);

    expect(ports.paymentStore.create).not.toHaveBeenCalled();
    expect(provider.payment.pay).not.toHaveBeenCalled();
  });

  test('an off-allowlist shopper returnUrl is rejected at intake, before any CT Payment or charge', async () => {
    await expect(
      createPayment({ env, data: data({ returnUrl: 'https://evil.test/steal' }) }, { ports, provider }),
    ).rejects.toBeDefined();

    expect(ports.paymentStore.create).not.toHaveBeenCalled();
    expect(provider.payment.pay).not.toHaveBeenCalled();
  });

  test('an EMPTY allowlist admits a shopper returnUrl on any http(s) origin at intake', async () => {
    const openEnv = makeFakeEnv({ allowedReturnOrigins: [] });

    await createPayment(
      { env: openEnv, data: data({ returnUrl: 'https://other-shop.test/return' }) },
      { ports, provider },
    );

    expect(ports.paymentStore.create).toHaveBeenCalledTimes(1);
    expect(provider.payment.pay).toHaveBeenCalledTimes(1);
  });

  test('an EMPTY allowlist still refuses a non-http(s) returnUrl at intake, before any CT Payment or charge', async () => {
    const openEnv = makeFakeEnv({ allowedReturnOrigins: [] });

    await expect(
      createPayment({ env: openEnv, data: data({ returnUrl: 'javascript:alert(1)' }) }, { ports, provider }),
    ).rejects.toBeDefined();

    expect(ports.paymentStore.create).not.toHaveBeenCalled();
    expect(provider.payment.pay).not.toHaveBeenCalled();
  });

  test('N2: an unknown / not-enabled paymentMethodCode is refused before any CT Payment or vendor charge', async () => {
    // The catalogue enables only 'card' (beforeEach); a request naming another method must be refused, not
    // charged on a disabled default.
    await expect(
      createPayment({ env, data: data({ paymentMethodCode: 'ideal-not-enabled' }) }, { ports, provider }),
    ).rejects.toThrow(/not enabled/);

    expect(ports.paymentStore.create).not.toHaveBeenCalled();
    expect(provider.payment.pay).not.toHaveBeenCalled();
  });

  test('shopper disclosure: a vendor-refused charge surfaces a generic public message; the vendor reason stays private', async () => {
    withMethod({ paymentMethodCode: 'card' });
    provider.payment.pay = jest
      .fn<typeof provider.payment.pay>()
      .mockRejectedValue(new PspError('PSP API error: card declined by issuer [operator hint]', 400));

    const err = await createPayment({ env, data: data() }, { ports, provider }).catch((e) => e);

    expect(err).toBeInstanceOf(Errorx);
    // The operator-facing vendor reason never reaches the shopper's public error body.
    expect((err as Errorx).message).not.toContain('card declined by issuer');
    // It is kept for diagnostics in the private message only.
    expect((err as Errorx).privateMessage).toContain('card declined by issuer');
  });

  /**
   * The update that closes a SUCCESSFUL charge is the SOLE writer of the reconciliation anchor — the vendor
   * payment id (`interfaceId`), the minted `merchantReference` and the owning store key — so a failure there
   * leaves a shopper whose money has moved with a CT Payment nothing can be matched to. Two things must hold:
   * the error names the commercetools write rather than the vendor that already answered, and the three
   * identifiers that make the orphaned charge findable are logged.
   */
  test('a commercetools write failing after the charge is named for the write and logs the reconciliation anchor', async () => {
    const chargeEnv = makeFakeEnv();
    ports.paymentStore.update = jest
      .fn<typeof ports.paymentStore.update>()
      .mockRejectedValue(new Error('the update service is unavailable'));

    const err = await createPayment({ env: chargeEnv, data: data() }, { ports, provider }).catch((e) => e);

    expect(err).toBeInstanceOf(ErrorGeneral);
    expect((err as Errorx).httpErrorStatus).toBe(500);
    // SEC-S4 is unaffected: the shopper still reads the one generic reason.
    expect((err as Errorx).message).toBe(SHOPPER_PAYMENT_FAILURE_MESSAGE);
    expect((err as Errorx).privateMessage).toContain('commercetools write failed');
    expect((err as Errorx).privateMessage).not.toContain("failed during 'createPayment'");
    expect(chargeEnv.logger.error).not.toHaveBeenCalledWith(
      "Provider operation 'createPayment' failed",
      expect.anything(),
    );
    expect(chargeEnv.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('commercetools'),
      expect.objectContaining({
        ctPaymentId: 'pay-1',
        providerPaymentId: 'vendor-charge-1',
        merchantReference: chargeArg().paymentRef,
      }),
    );
  });

  /**
   * A commercetools HTTP fault reaches the port as `CommercetoolsAPIError`, which IS an `Errorx`, so it
   * carries the status and message its raiser meant the caller to see (the error contract everywhere). The
   * anchor is just as lost on that path, so the identifiers are logged before the error passes through.
   */
  test('a typed commercetools failure after the charge passes through and still logs the reconciliation anchor', async () => {
    const chargeEnv = makeFakeEnv();
    ports.paymentStore.update = jest
      .fn<typeof ports.paymentStore.update>()
      .mockRejectedValue(
        new Errorx({ code: 'CommercetoolsAPIError', message: 'Service Unavailable', httpErrorStatus: 503 }),
      );

    const err = await createPayment({ env: chargeEnv, data: data() }, { ports, provider }).catch((e) => e);

    expect((err as Errorx).httpErrorStatus).toBe(503);
    expect(chargeEnv.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('commercetools'),
      expect.objectContaining({
        ctPaymentId: 'pay-1',
        providerPaymentId: 'vendor-charge-1',
        merchantReference: chargeArg().paymentRef,
      }),
    );
  });

  test('multi-store: the store is derived from the cart and stamped onto the payment', async () => {
    const baseCfg = await makeFakePorts().configResolver.resolve('seed');
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockImplementation(async (storeKey) => ({ ...baseCfg, storeKey }));
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
      store: { typeId: 'store', key: 'store-42' },
    } as never);

    await createPayment({ env, data: data() }, { ports, provider });

    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42');
    expect(ports.configResolver.resolveDefault).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: expect.objectContaining({ fields: expect.objectContaining({ storeKey: 'store-42' }) }),
      }),
    );
  });
});
