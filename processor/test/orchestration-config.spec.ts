/**
 * The read and config operations (`payment-config`, `store-config` CRUD,
 * `status`, `testConnection`), exercised with fake ports + a fake provider. Asserts the DELEGATION to
 * the provider `ConfigHandler` / `IntrospectionService`.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  getPaymentConfig,
  getStatus,
  getStoreConfig,
  testConnection,
  updateStoreConfig,
} from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import type { PaymentMethodConfig, PaymentMethodsObject } from '../src/domain';

/** A full per-method config with test-friendly defaults; every availability field is overridable. */
const method = (over: Partial<PaymentMethodConfig> = {}): PaymentMethodConfig => ({
  paymentMethodCode: 'card',
  enabled: true,
  name: { en: 'Card' },
  description: { en: 'Pay by card' },
  surcharge: {},
  countries: [],
  sendBasketData: false,
  ...over,
});

/** A persisted payment-methods object holding one environment's method list. */
const persisted = (methods: PaymentMethodConfig[], mode: 'sandbox' | 'live' = 'sandbox'): PaymentMethodsObject => ({
  store: 'store-1',
  environments: { [mode]: { paymentMethods: methods } },
});

describe('orchestration/payment-config + store-config', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('getPaymentConfig: reads the cart once, the catalogue once, the CO once — no N+1', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(ports.cartReader.getCart).toHaveBeenCalledTimes(1);
    expect(provider.introspection.availableMethods).toHaveBeenCalledTimes(1);
    expect(ports.paymentMethodsStore.readEffective).toHaveBeenCalledTimes(1);
    expect(res.environment).toBe('sandbox');
    expect(res.paymentMethods).toEqual([
      {
        code: 'card',
        name: 'Card',
        description: 'Pay by card',
        surcharge: 0,
        requiresCustomerData: false,
        clickToPayEnabled: false,
        rendersOwnPayButton: false,
        needsAmountData: false,
        logo: 'https://connector.test/assets/method-logo/card',
      },
    ]);
  });

  /**
   * The connector's display order is imposed ONCE, by the provider at the catalogue boundary.
   * Both lists that read that catalogue must then render it as it arrives — so this pins that the shopper
   * projection reorders nothing, which is what lets the merchant screen and the checkout agree.
   */
  test('getPaymentConfig: offers the methods in the order the catalogue answered', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'paylater-invoice',
          supportsAuthorize: true,
          supportsCharge: false,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'paypal',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(
        // Persisted in a DIFFERENT order on purpose: the catalogue decides, not the stored document.
        persisted([
          method({ paymentMethodCode: 'paypal', name: { en: 'PayPal' } }),
          method({ paymentMethodCode: 'paylater-invoice', name: { en: 'Invoice' } }),
          method(),
        ]),
      );

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods.map((m) => m.code)).toEqual(['paylater-invoice', 'card', 'paypal']);
  });

  /**
   * The browser is handed a logo url because it cannot build one: it knows neither the connector's path
   * nor the origin it answers on. The artwork ships WITH the connector and is served by it, so the url is
   * derived from the method CODE and nothing about it is stored.
   */
  test('getPaymentConfig: hands the browser the logo url for each method it ships artwork for', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(persisted([method()]));

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods[0].logo).toBe('https://connector.test/assets/method-logo/card');
  });

  /**
   * Click to Pay is a second affordance INSIDE the card element's iframe, not a method of its own
   *. The shopper config therefore carries the merchant's flag on the card method and on no
   * other, so the checkout surface knows whether to let the vendor draw it — the browser hardcodes no
   * vendor method code of its own.
   *
   * The flag is emitted as an EXPLICIT boolean, and `false` when the merchant configured nothing: the
   * vendor's own default is ON, so an absent value would show an affordance nobody enabled.
   */
  test('getPaymentConfig: carries the Click-to-Pay flag on the card method and on no other', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'paypal',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(
        persisted([
          method({ clickToPayEnabled: true }),
          method({ paymentMethodCode: 'paypal', name: { en: 'PayPal' }, clickToPayEnabled: true }),
        ]),
      );

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods.map((m) => [m.code, m.clickToPayEnabled])).toEqual([
      ['card', true],
      // PayPal's surface cannot carry it, so the field is ABSENT rather than false — a browser reading it
      // there would learn nothing it could act on.
      ['paypal', undefined],
    ]);
  });

  test('getPaymentConfig: a card the merchant did not enable Click to Pay on says so explicitly', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(persisted([method()]));

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods[0].clickToPayEnabled).toBe(false);
  });

  /**
   * The buy-now-pay-later family is refused without a described payer, so the shopper config tells the
   * checkout surface WHICH methods need the vendor's customer form (`requiresCustomerData`) and hands it the
   * data to prefill that form with (`shopper`). Both are the provider's/platform's knowledge crossing to the
   * browser so it hardcodes neither a vendor method list nor a guess about what the platform knows.
   */
  test('getPaymentConfig: flags the methods whose charge requires a described customer', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'paylater-invoice',
          supportsAuthorize: true,
          supportsCharge: false,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([method(), method({ paymentMethodCode: 'paylater-invoice' })]),
        version: 1,
      });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods.map((m) => [m.code, m.requiresCustomerData])).toEqual([
      ['card', false],
      ['paylater-invoice', true],
    ]);
  });

  test('getPaymentConfig: prefills the shopper block from the cart and the customer profile', async () => {
    // A method that needs the payer described is what makes the profile worth reading — see the card-only
    // case below, which reads nothing.
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'paylater-invoice',
          supportsAuthorize: true,
          supportsCharge: false,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method({ paymentMethodCode: 'paylater-invoice' })]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      customerId: 'cust-77',
      customerEmail: 'branko@example.com',
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      lineItems: [],
      billingAddress: {
        firstName: 'Branko',
        lastName: 'Janjic',
        streetName: 'Hugo-Junkers-Str.',
        streetNumber: '5',
        postalCode: '60386',
        city: 'Frankfurt am Main',
        country: 'DE',
        salutation: 'Mr',
        phone: '+49 69 000',
      },
    } as never);
    ports.customerReader.dateOfBirth = jest.fn<typeof ports.customerReader.dateOfBirth>().mockResolvedValue('19861212');

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.shopper).toEqual({
      // The merchant-side reference the vendor customer is created under.
      customerReference: 'cust-77',
      firstName: 'Branko',
      lastName: 'Janjic',
      email: 'branko@example.com',
      salutation: 'mr',
      dateOfBirth: '19861212',
      phone: '+49 69 000',
      billingAddress: {
        name: 'Branko Janjic',
        street: 'Hugo-Junkers-Str.',
        houseNumber: '5',
        postalCode: '60386',
        city: 'Frankfurt am Main',
        countryCode: 'DE',
      },
    });
  });

  /**
   * The prefill is the shopper's own data going back to their own browser, and it carries no CREDENTIAL and no
   * vendor token. Two identifiers are there deliberately: `customerReference`, the platform customer
   * id the vendor customer is created under - without it the vendor cannot recognise a returning shopper - and
   * `vendorCustomerId`, the resource the surface must UPDATE instead of creating a second one. Both are the
   * shopper's own, and this pins that nothing else joined them.
   */
  test('getPaymentConfig: the shopper block carries no secret and no vendor token', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      customerId: 'cust-77',
      customerEmail: 'branko@example.com',
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    const serialized = JSON.stringify(res.shopper ?? {});
    expect(serialized).not.toContain('priv');
    expect(res.shopper ?? {}).not.toHaveProperty('customerId');
    // The reference IS the platform customer id, and it is the only identifier the block carries beside the
    // held vendor customer (absent here: this provider fake offers no directory).
    expect(res.shopper).toMatchObject({ customerReference: 'cust-77' });
    expect(res.shopper ?? {}).not.toHaveProperty('vendorCustomerId');
  });

  /**
   * The WALLET block: Apple's and Google's sheet data, assembled by the PROVIDER from the merchant's
   * per-method block plus what the purchase states, and carried opaque so the surface passes it to the vendor's
   * setter verbatim. Only for a wallet - every other method carries none, and `rendersOwnPayButton` is what tells
   * the host not to draw a second button.
   */
  test('getPaymentConfig: carries the wallet payload for a wallet method and none for the card', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'googlepay',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          channel: '9138634f404b',
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([
          method(),
          method({ paymentMethodCode: 'googlepay', googlePay: { merchantId: 'm-1', merchantName: 'Shop' } }),
        ]),
        version: 1,
      });

    const res = await getPaymentConfig({ env }, { ports, provider });

    const [card, google] = res.paymentMethods;
    expect(card).not.toHaveProperty('wallet');
    expect(card?.rendersOwnPayButton).toBe(false);
    expect(google?.rendersOwnPayButton).toBe(true);
    // The fake provider echoes what it was handed, so this pins the INPUT core assembles: the merchant's block,
    // the vendor channel off the catalogue entry, and the purchase.
    expect(google?.wallet).toMatchObject({
      kind: 'googlepay',
      payload: {
        googlePay: { merchantId: 'm-1', merchantName: 'Shop' },
        channel: '9138634f404b',
        currencyCode: 'EUR',
        amountMinor: 1500,
        storeName: 'store-1',
      },
    });
  });

  /**
   * The PAYER KIND gate. The vendor states `allowCustomerTypes` per method - the instalment and the
   * SEPA mandate are `B2C` only on a live account - and a cart whose BILLING address names a company is a
   * business purchase. So a company removes those methods from the offered list instead of having them refused
   * at charge time, and the config states the kind it filtered by.
   */
  test('getPaymentConfig: a company on the billing address drops the B2C-only methods', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: ['B2B', 'B2C'],
          cardNetworks: [],
        },
        {
          code: 'paylater-installment',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: ['B2C'],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([method(), method({ paymentMethodCode: 'paylater-installment' })]),
        version: 1,
      });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      billingAddress: { country: 'DE', company: 'Universum GmbH' },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.customerType).toBe('B2B');
    expect(res.paymentMethods.map((m) => m.code)).toEqual(['card']);
  });

  // The same account, a PRIVATE purchase: both methods stand, and the config says B2C.
  test('getPaymentConfig: a private purchase keeps the B2C-only methods', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: ['B2B', 'B2C'],
          cardNetworks: [],
        },
        {
          code: 'paylater-installment',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: ['B2C'],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([method(), method({ paymentMethodCode: 'paylater-installment' })]),
        version: 1,
      });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      billingAddress: { country: 'DE' },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.customerType).toBe('B2C');
    expect(res.paymentMethods.map((m) => m.code)).toEqual(['card', 'paylater-installment']);
  });

  // A company on the SHIPPING address is a delivery destination, not the payer - it must not flip the kind.
  test('getPaymentConfig: a company on the shipping address alone stays B2C', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      shippingAddress: { country: 'DE', company: 'Warehouse GmbH' },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.customerType).toBe('B2C');
  });

  /**
   * The purchase COUNTRY and the per-method figures flag. The instalment surface fetches its plan list
   * on mount and the vendor refuses that fetch without a country, so the config carries the SAME country the
   * eligibility filter judged the method by - one answer, not two. Every other method needs none of it.
   */
  test('getPaymentConfig: carries the purchase country and flags only the instalment surface', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'paylater-installment',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([method(), method({ paymentMethodCode: 'paylater-installment' })]),
        version: 1,
      });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      billingAddress: { country: 'DE' },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.country).toBe('DE');
    expect(res.paymentMethods.map((m) => [m.code, m.needsAmountData])).toEqual([
      ['card', false],
      ['paylater-installment', true],
    ]);
  });

  // A cart that names no country carries none: the surface then asks for what it can, and nothing is invented.
  test('getPaymentConfig: omits the country when the cart names none', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res).not.toHaveProperty('country');
  });

  /**
   * The held vendor customer: the surface must UPDATE the resource the account already holds, or the
   * element POSTs a second customer and the vendor refuses it (`"customerId already exists"`). Read by the
   * merchant reference, which is the platform customer id, and only for a signed-in shopper.
   */
  test('getPaymentConfig: carries the vendor customer the account already holds for the shopper', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      customerId: 'cust-77',
      customerEmail: 'branko@example.com',
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      lineItems: [],
    } as never);
    const heldCustomerId = jest.fn(async (...args: [unknown, string]) => `s-cst-held-${args[1]}`);
    (provider as { customers?: unknown }).customers = { heldCustomerId };

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(heldCustomerId).toHaveBeenCalledTimes(1);
    // Read BY THE MERCHANT REFERENCE - the platform customer id - not by a vendor id nobody holds yet.
    expect(heldCustomerId.mock.calls[0]?.[1]).toBe('cust-77');
    expect(res.shopper).toMatchObject({ customerReference: 'cust-77', vendorCustomerId: 's-cst-held-cust-77' });
  });

  // A GUEST has no reference to read by, so the lookup is not even attempted.
  test('getPaymentConfig: reads no held vendor customer for a guest cart', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    const heldCustomerId = jest.fn(async (...args: [unknown, string]) => `s-cst-held-${args[1]}`);
    (provider as { customers?: unknown }).customers = { heldCustomerId };

    await getPaymentConfig({ env }, { ports, provider });

    expect(heldCustomerId).not.toHaveBeenCalled();
  });

  // A guest cart with nothing to prefill sends NO block, rather than an object of empty strings the vendor
  // form would treat as answers.
  test('getPaymentConfig: omits the shopper block when the platform knows nothing about the payer', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
      lineItems: [],
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.shopper).toBeUndefined();
    expect(ports.customerReader.dateOfBirth).not.toHaveBeenCalled();
  });

  test('getPaymentConfig: exposes the session cart currency + fractionDigits so the enabler can format surcharges', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      totalPrice: { centAmount: 1500, currencyCode: 'EUR', fractionDigits: 2 },
    } as never);

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.currency).toBe('EUR');
    expect(res.fractionDigits).toBe(2);
  });

  test('getPaymentConfig: exposes the shopper public key and NEVER the private key value', async () => {
    ports.configResolver.resolveDefault = jest.fn<typeof ports.configResolver.resolveDefault>().mockResolvedValue({
      storeKey: 'store-1',
      mode: 'sandbox',
      credentials: { publicKey: 'pub-SHOPPER-SAFE', privateKey: 'priv-NEVER-LEAK' },
    } as never);
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method()]), version: 1 });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.publicKey).toBe('pub-SHOPPER-SAFE');
    expect(JSON.stringify(res)).not.toContain('priv-NEVER-LEAK');
  });

  test('getPaymentConfig: only enabled, cart-eligible methods survive the availability filter', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      country: 'DE',
      totalPrice: { centAmount: 2000, currencyCode: 'EUR' },
    } as never);
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'disabled',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'below-min',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'above-max',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'wrong-country',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'not-persisted',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([
          method({
            paymentMethodCode: 'card',
            enabled: true,
            countries: ['DE'],
            surcharge: { EUR: 150 },
          }),
          method({ paymentMethodCode: 'disabled', enabled: false }),
          method({
            paymentMethodCode: 'below-min',
            enabled: true,
            minAmount: { EUR: 5000 },
          }),
          method({
            paymentMethodCode: 'above-max',
            enabled: true,
            maxAmount: { EUR: 1000 },
          }),
          method({ paymentMethodCode: 'wrong-country', enabled: true, countries: ['FR'] }),
        ]),
        version: 1,
      });

    const res = await getPaymentConfig({ env }, { ports, provider });

    // Only `card` clears every gate (enabled, 2000 within range, DE in countries, present in the catalogue).
    // `not-persisted` is a catalogue code with no config → disabled default → dropped.
    expect(res.paymentMethods).toEqual([
      {
        code: 'card',
        name: 'Card',
        description: 'Pay by card',
        surcharge: 150,
        requiresCustomerData: false,
        clickToPayEnabled: false,
        rendersOwnPayButton: false,
        needsAmountData: false,
        logo: 'https://connector.test/assets/method-logo/card',
      },
    ]);
  });

  /**
   * The per-currency window and the VENDOR's own coverage — the two gates the shopper list gained. Each
   * case runs the SAME cart through one changed variable, so the failing gate is the only difference.
   */
  describe('getPaymentConfig: the four-gate intersection', () => {
    /** A EUR cart of 2000 minor units, billed to DE, unless a case overrides the cart. */
    function offer(
      over: {
        method?: Partial<PaymentMethodConfig>;
        catalogue?: Record<string, unknown>;
        cart?: Record<string, unknown>;
      } = {},
    ) {
      ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
        id: 'cart-1',
        version: 1,
        lineItems: [],
        billingAddress: { country: 'DE' },
        totalPrice: { centAmount: 2000, currencyCode: 'EUR' },
        ...over.cart,
      } as never);
      provider.introspection.availableMethods = jest
        .fn<typeof provider.introspection.availableMethods>()
        .mockResolvedValue([
          {
            code: 'card',
            supportsAuthorize: true,
            supportsCharge: true,
            countries: [],
            currencies: [],
            customerTypes: [],
            cardNetworks: [],
            ...over.catalogue,
          } as never,
        ]);
      ports.paymentMethodsStore.readWithVersion = jest
        .fn<typeof ports.paymentMethodsStore.readWithVersion>()
        .mockResolvedValue({ value: persisted([method({ enabled: true, ...over.method })]), version: 1 });
      return getPaymentConfig({ env }, { ports, provider });
    }

    /** The offered method codes, which is what every gate ultimately decides. */
    const codes = async (over?: Parameters<typeof offer>[0]) => (await offer(over)).paymentMethods.map((m) => m.code);

    test('applies a window configured FOR THE CART CURRENCY', async () => {
      await expect(codes({ method: { minAmount: { EUR: 5000 } } })).resolves.toEqual([]);
      await expect(codes({ method: { maxAmount: { EUR: 1000 } } })).resolves.toEqual([]);
      await expect(codes({ method: { minAmount: { EUR: 1000 }, maxAmount: { EUR: 5000 } } })).resolves.toEqual([
        'card',
      ]);
    });

    // The heart of the per-currency decision: the SAME 2000 that is out of range in EUR is unconstrained in
    // a currency the merchant configured no window for. Nothing is converted, so nothing is compared across
    // currencies.
    test('ignores a window configured for a DIFFERENT currency than the cart', async () => {
      await expect(
        codes({
          method: { minAmount: { USD: 5000 } },
        }),
      ).resolves.toEqual(['card']);
    });

    test('drops a method the VENDOR does not serve for the billing country', async () => {
      await expect(codes({ catalogue: { countries: ['FR'] } })).resolves.toEqual([]);
      await expect(codes({ catalogue: { countries: ['DE', 'FR'] } })).resolves.toEqual(['card']);
    });

    test('drops a method the VENDOR does not serve in the cart currency', async () => {
      await expect(codes({ catalogue: { currencies: ['CHF'] } })).resolves.toEqual([]);
      await expect(codes({ catalogue: { currencies: ['EUR', 'CHF'] } })).resolves.toEqual(['card']);
    });

    test('treats empty vendor coverage as unrestricted', async () => {
      await expect(codes({ catalogue: { countries: [], currencies: [] } })).resolves.toEqual(['card']);
    });

    // The vendor's coverage restricts the PAYER, so the billing country decides — not the cart's market.
    test('judges the vendor country gate on the BILLING country, not cart.country', async () => {
      await expect(
        codes({ catalogue: { countries: ['AT'] }, cart: { country: 'AT', billingAddress: { country: 'DE' } } }),
      ).resolves.toEqual([]);
      await expect(
        codes({ catalogue: { countries: ['DE'] }, cart: { country: 'AT', billingAddress: { country: 'DE' } } }),
      ).resolves.toEqual(['card']);
    });

    test('falls back to the cart country when the cart carries no billing address', async () => {
      await expect(
        codes({ catalogue: { countries: ['AT'] }, cart: { country: 'AT', billingAddress: undefined } }),
      ).resolves.toEqual(['card']);
    });

    test('resolves the shopper surcharge for the cart currency, and zero when none is configured', async () => {
      const eur = await offer({ method: { surcharge: { EUR: 150 } } });
      expect(eur.paymentMethods[0]?.surcharge).toBe(150);

      const other = await offer({ method: { surcharge: { USD: 150 } } });
      expect(other.paymentMethods[0]?.surcharge).toBe(0);
    });
  });

  test('getPaymentConfig: an empty countries list means all countries are eligible', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
    } as never);
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: persisted([method({ countries: [] })]), version: 1 });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods.map((m) => m.code)).toEqual(['card']);
  });

  test('getPaymentConfig: name/description are locale-resolved for the cart locale', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      locale: 'de-DE',
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
    } as never);
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: persisted([method({ name: { de: 'Karte', en: 'Card' }, description: { de: 'Mit Karte', en: 'Card' } })]),
        version: 1,
      });

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.locale).toBe('de-DE');
    expect(res.paymentMethods[0]).toEqual({
      code: 'card',
      name: 'Karte',
      description: 'Mit Karte',
      surcharge: 0,
      requiresCustomerData: false,
      clickToPayEnabled: false,
      rendersOwnPayButton: false,
      needsAmountData: false,
      logo: 'https://connector.test/assets/method-logo/card',
    });
  });

  test('getPaymentConfig: the shopper store is derived from the cart, not a deployment key', async () => {
    ports.cartReader.getCart = jest.fn<typeof ports.cartReader.getCart>().mockResolvedValue({
      id: 'cart-1',
      version: 1,
      lineItems: [],
      totalPrice: { centAmount: 1500, currencyCode: 'EUR' },
      store: { typeId: 'store', key: 'store-42' },
    } as never);

    await getPaymentConfig({ env }, { ports, provider });

    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42');
    expect(ports.configResolver.resolveDefault).not.toHaveBeenCalled();
    expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
  });

  test('getPaymentConfig: a cart with no store resolves the env.default config', async () => {
    // The default fake cart carries no store.
    await getPaymentConfig({ env }, { ports, provider });

    expect(ports.configResolver.resolveDefault).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
  });

  /**
   * A cart naming no store resolves the default config, and the `__default__` scope's payment-methods
   * document is the ONLY thing that can put a method in front of that shopper: without it every catalogue
   * code merges to a disabled default and the shopper is offered nothing at all, which reads as a broken
   * endpoint rather than as absent config.
   */
  test('getPaymentConfig: a store-less cart is offered the default scope methods', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'card',
          supportsAuthorize: true,
          supportsCharge: true,
          countries: [],
          currencies: ['EUR'],
          customerTypes: [],
          cardNetworks: [],
        },
        {
          code: 'klarna',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: ['EUR'],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue({
        store: '__default__',
        environments: { sandbox: { paymentMethods: [method({ paymentMethodCode: 'card', name: { en: 'Card' } })] } },
      });

    const res = await getPaymentConfig({ env }, { ports, provider });

    // `card` carries an entry marked enabled; `klarna` has none, so it merges to a disabled default and
    // the availability filter drops it.
    expect(res.paymentMethods.map((m) => m.code)).toEqual(['card']);
  });

  test('getStoreConfig: unconfigured store → {}; configured store → provider.config.redact', async () => {
    expect(await getStoreConfig({ env }, { ports, provider })).toStrictEqual({});

    ports.configStore.read = jest
      .fn<typeof ports.configStore.read>()
      .mockResolvedValue({ mode: 'sandbox', environments: { sandbox: { credentials: { publicKey: 'k' } } } });
    provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'sandbox' });

    const res = await getStoreConfig({ env }, { ports, provider });
    expect(provider.config.redact).toHaveBeenCalledTimes(1);
    expect(res).toStrictEqual({ mode: 'sandbox' });
  });

  test('getStoreConfig: an explicit ctx.storeKey (X-Store-Key) overrides the deployment default', async () => {
    await getStoreConfig({ env, storeKey: 'store-42' }, { ports, provider });
    expect(ports.configStore.read).toHaveBeenCalledWith('store-42');
    expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
  });

  test('updateStoreConfig: an explicit ctx.storeKey (X-Store-Key) scopes the read + CAS write', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 3 });
    provider.config.reconcileSecrets = jest
      .fn<typeof provider.config.reconcileSecrets>()
      .mockReturnValue({ mode: 'live' });
    ports.configStore.write = jest.fn<typeof ports.configStore.write>().mockResolvedValue({ mode: 'live' });

    await updateStoreConfig({ env, body: { mode: 'live' }, storeKey: 'store-42' }, { ports, provider });

    expect(ports.configStore.readWithVersion).toHaveBeenCalledWith('store-42');
    expect(ports.configStore.write).toHaveBeenCalledWith('store-42', { mode: 'live' }, 3);
    // storeKey() is consulted once — the reserved-key guard compares the write's effective target against
    // the project key ('store-1' here) — but the explicit 'store-42' (not the fallback) scopes the read + write.
    expect(ports.configResolver.storeKey).toHaveBeenCalledTimes(1);
  });

  test('updateStoreConfig: invalid settings are rejected before any persistence', async () => {
    provider.config.validate = jest
      .fn<typeof provider.config.validate>()
      .mockReturnValue({ valid: false, errors: ['flows: unexpected property'] });

    await expect(
      updateStoreConfig({ env, body: { settings: {} as never }, storeKey: 'de-store' }, { ports, provider }),
    ).rejects.toBeDefined();
    expect(ports.configStore.write).not.toHaveBeenCalled();
  });

  test('updateStoreConfig: valid → validate + reconcileSecrets + write(CAS) + redact', async () => {
    ports.configStore.readWithVersion = jest
      .fn<typeof ports.configStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: 7 });
    provider.config.reconcileSecrets = jest
      .fn<typeof provider.config.reconcileSecrets>()
      .mockReturnValue({ mode: 'live' });
    ports.configStore.write = jest.fn<typeof ports.configStore.write>().mockResolvedValue({ mode: 'live' });
    provider.config.redact = jest.fn<typeof provider.config.redact>().mockReturnValue({ mode: 'live' });

    const res = await updateStoreConfig({ env, body: { mode: 'live' }, storeKey: 'de-store' }, { ports, provider });

    expect(provider.config.reconcileSecrets).toHaveBeenCalledWith({ mode: 'live' }, null);
    expect(ports.configStore.write).toHaveBeenCalledWith('de-store', { mode: 'live' }, 7);
    expect(provider.config.redact).toHaveBeenCalledWith({ mode: 'live' });
    expect(res).toStrictEqual({ mode: 'live' });
    // One GET per PUT on the non-probe path: the single readWithVersion, no separate version read and no
    // resolver re-read (the probe path is not entered when no credential changed).
    expect(ports.configStore.readWithVersion).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
  });

  test('testConnection: delegates to the provider probe', async () => {
    provider.introspection.testConnection = jest
      .fn<typeof provider.introspection.testConnection>()
      .mockResolvedValue({ success: false, message: 'bad creds' });

    const res = await testConnection({ env }, { ports, provider });
    expect(res).toStrictEqual({ success: false, message: 'bad creds' });
  });

  test('testConnection: an explicit ctx.storeKey (X-Store-Key) probes THAT store, not the deployment default', async () => {
    await testConnection({ env, storeKey: 'store-42' }, { ports, provider });
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42');
    expect(ports.configResolver.storeKey).not.toHaveBeenCalled();
  });

  test('testConnection: no ctx.storeKey → resolves the deployment store key (single-store fallback)', async () => {
    await testConnection({ env }, { ports, provider });
    expect(ports.configResolver.storeKey).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-1');
  });

  test('getStatus: composes the permissions health check with the provider status checks', async () => {
    provider.introspection.statusChecks = jest
      .fn<typeof provider.introspection.statusChecks>()
      .mockResolvedValue([{ name: 'fake-psp-connectivity', status: 'UP' }]);

    const res = await getStatus({ env }, { ports, provider });

    expect(ports.permissionsHealth.commercetoolsPermissions).toHaveBeenCalledTimes(1);
    expect(provider.introspection.statusChecks).toHaveBeenCalledTimes(1);
    expect(res.status).toBeDefined();
  });

  test('getStatus: reports connector-provisioning UP once the payment type and states exist', async () => {
    const res = await getStatus({ env }, { ports, provider });

    const check = res.checks.find((c) => c.name === 'connector-provisioning');
    expect(check?.status).toBe('UP');
  });

  // Nothing provisions these any more except saving a connection, so an install that never did shows here
  // rather than on the first payment write.
  test('getStatus: reports connector-provisioning DOWN naming what is missing', async () => {
    ports.provisioning.missingObjects = jest
      .fn<typeof ports.provisioning.missingObjects>()
      .mockResolvedValue(["payment custom type 'psp-payment'"]);

    const res = await getStatus({ env }, { ports, provider });

    const check = res.checks.find((c) => c.name === 'connector-provisioning');
    expect(check?.status).toBe('DOWN');
    expect(check?.message).toMatch(/save a store connection/);
    expect(check?.details).toEqual(expect.objectContaining({ missing: ["payment custom type 'psp-payment'"] }));
  });
});
