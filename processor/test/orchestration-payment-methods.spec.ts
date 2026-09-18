/**
 * the payment-methods configuration surface.
 *
 * `getPaymentMethods` merges the LIVE keypair catalogue (`provider.introspection.availableMethods`)
 * with the per-store persisted config held in the SEPARATE, PLAINTEXT `unzer-connector-payment-methods`
 * Custom Object: every catalogue code returns its persisted config if present, else a disabled default;
 * a persisted method no longer in the catalogue is dropped; the catalogue order is preserved.
 * `updatePaymentMethods` CAS-writes the `paymentMethods[]`, reusing the reserved-project-key guard and
 * the `X-Store-Key` target-store rule exactly as store-config does, and rejects an invalid payload with
 * a secret-free 400.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { assertPaymentMethodRules, getPaymentMethods, updatePaymentMethods } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import type { PaymentMethodConfig, PaymentMethodsObject } from '../src/domain';

/** A fully-populated persisted method config (all fields the merge must preserve verbatim). */
const configured = (overrides: Partial<PaymentMethodConfig> = {}): PaymentMethodConfig => ({
  paymentMethodCode: 'card',
  enabled: true,
  name: { en: 'Card', de: 'Karte' },
  description: { en: 'Pay by card' },
  bookingMode: 'authorize',
  minAmount: { EUR: 100 },
  maxAmount: { EUR: 500000 },
  surcharge: { EUR: 50 },
  countries: ['DE', 'AT'],
  sendBasketData: true,
  ...overrides,
});

/** The stored Custom Object wrapping per-environment lists of method configs. */
const storedObject = (environments: {
  sandbox?: PaymentMethodConfig[];
  live?: PaymentMethodConfig[];
}): PaymentMethodsObject => ({
  store: 'de-store',
  environments: {
    ...(environments.sandbox ? { sandbox: { paymentMethods: environments.sandbox } } : {}),
    ...(environments.live ? { live: { paymentMethods: environments.live } } : {}),
  },
});

describe('getPaymentMethods — merge live catalogue with persisted config', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('returns the persisted config for a configured method and a disabled default for the rest', async () => {
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
        {
          code: 'sofort',
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
      .mockResolvedValue({ value: storedObject({ sandbox: [configured()] }), version: 3 });

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    // Catalogue order preserved; the configured method returned verbatim (plus the read-only
    // `supportsAuthorize` capability), the others defaulted with `sendBasketData` false.
    expect(result.paymentMethods.map((m) => m.paymentMethodCode)).toEqual(['card', 'paypal', 'sofort']);
    expect(result.paymentMethods[0]).toEqual({
      ...configured(),
      logo: 'https://connector.test/assets/method-logo/card',
      supportsAuthorize: true,
      supportsCharge: true,
      vendorCountries: [],
      vendorCurrencies: [],
      vendorCustomerTypes: [],
      vendorCardNetworks: [],
    });
    expect(result.paymentMethods[1]).toEqual({
      paymentMethodCode: 'paypal',
      enabled: false,
      name: {},
      description: {},
      surcharge: {},
      countries: [],
      // Basket data ON by default: several Unzer methods require it and none is harmed by it.
      sendBasketData: true,
      supportsAuthorize: true,
      supportsCharge: true,
      vendorCountries: [],
      vendorCurrencies: [],
      vendorCustomerTypes: [],
      vendorCardNetworks: [],
    });
    expect(result.paymentMethods[2].paymentMethodCode).toBe('sofort');
    expect(result.paymentMethods[2].enabled).toBe(false);
    expect(result.paymentMethods[2].supportsAuthorize).toBe(false);
  });

  /**
   * The DEFAULT-scope inheritance. A store that was never configured on its own runs on the
   * methods the merchant configured on `__default__` — the same layer its CREDENTIALS already inherit
   *, so the merchant screen cannot show a store transacting on one account with the methods of
   * no account at all. The port answers the effective object; this asserts the surface reads THAT.
   */
  test('a store with no object of its own shows the DEFAULT scope’s configured methods', async () => {
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
    // No object under `de-store`; the default scope carries the enabled card.
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(storedObject({ sandbox: [configured()] }));
    // No connection of its own either — that is what makes it inherit at all.
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockImplementation(async (storeKey, mode) => ({
        ...(await makeFakePorts().configResolver.resolve(storeKey, mode)),
        inheritsDefaultScope: true,
      }));

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    expect(ports.paymentMethodsStore.readEffective).toHaveBeenCalledWith('de-store', true);
    expect(result.paymentMethods[0].enabled).toBe(true);
    expect(result.paymentMethods[0].name).toEqual({ en: 'Card', de: 'Karte' });
  });

  /**
   * The logo url is DERIVED from the method code against this deployment's origin, never stored. Storing it
   * would freeze that origin into the document, and a redeploy would leave every logo pointing at an
   * address that no longer serves it.
   */
  test('derives the logo url from the method code, against the connector origin', async () => {
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
          code: 'a-code-with-no-artwork',
          supportsAuthorize: false,
          supportsCharge: true,
          countries: [],
          currencies: [],
          customerTypes: [],
          cardNetworks: [],
        },
      ]);
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(storedObject({ sandbox: [configured()] }));

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    expect(result.paymentMethods[0].logo).toBe('https://connector.test/assets/method-logo/card');
    // A code this release ships no drawing for carries NO key, rather than a url that would answer 404.
    expect(result.paymentMethods[1]).not.toHaveProperty('logo');
  });

  test('drops a persisted method that is no longer in the live catalogue', async () => {
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
        value: storedObject({ sandbox: [configured(), configured({ paymentMethodCode: 'legacy-wallet' })] }),
        version: 1,
      });

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    expect(result.paymentMethods.map((m) => m.paymentMethodCode)).toEqual(['card']);
  });

  test('reads a legacy scalar amount as absent (no shim; the next save overwrites it)', async () => {
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
        value: storedObject({
          // The old shape: bare minor-unit numbers instead of currency maps.
          sandbox: [{ ...configured(), minAmount: 100, maxAmount: 500000, surcharge: 50 } as never],
        }),
        version: 1,
      });

    const [card] = (await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider })).paymentMethods;

    expect(card.minAmount).toBeUndefined();
    expect(card.maxAmount).toBeUndefined();
    expect(card.surcharge).toEqual({});
    // Everything that is NOT an amount survives the normalisation untouched.
    expect(card.name).toEqual({ en: 'Card', de: 'Karte' });
    expect(card.countries).toEqual(['DE', 'AT']);
  });

  test('drops a malformed currency entry while keeping the well-formed ones', async () => {
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
        value: storedObject({
          sandbox: [{ ...configured(), surcharge: { EUR: 50, eur: 7, USD: 1.5 } } as never],
        }),
        version: 1,
      });

    const [card] = (await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider })).paymentMethods;

    expect(card.surcharge).toEqual({ EUR: 50 });
  });

  test('preserves the catalogue order even when the persisted list is in another order', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
        {
          code: 'sofort',
          supportsAuthorize: false,
          supportsCharge: true,
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
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: storedObject({
          sandbox: [configured({ paymentMethodCode: 'paypal' }), configured({ paymentMethodCode: 'card' })],
        }),
        version: 1,
      });

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    expect(result.paymentMethods.map((m) => m.paymentMethodCode)).toEqual(['sofort', 'card', 'paypal']);
  });

  test('with no persisted Custom Object every catalogue method is a disabled default', async () => {
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
      .mockResolvedValue({ value: null, version: undefined });

    const result = await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    // Every default carries `sendBasketData` true and the catalogue's read-only capabilities.
    expect(result.paymentMethods).toEqual([
      {
        paymentMethodCode: 'card',
        enabled: false,
        logo: 'https://connector.test/assets/method-logo/card',
        name: {},
        description: {},
        surcharge: {},
        countries: [],
        sendBasketData: true,
        supportsAuthorize: true,
        supportsCharge: true,
        vendorCountries: [],
        vendorCurrencies: [],
        vendorCustomerTypes: [],
        vendorCardNetworks: [],
      },
      {
        paymentMethodCode: 'paypal',
        enabled: false,
        name: {},
        description: {},
        surcharge: {},
        countries: [],
        sendBasketData: true,
        supportsAuthorize: false,
        supportsCharge: true,
        vendorCountries: [],
        vendorCurrencies: [],
        vendorCustomerTypes: [],
        vendorCardNetworks: [],
      },
    ]);
  });

  test('resolves the catalogue for the targeted store (X-Store-Key)', async () => {
    await getPaymentMethods({ env, storeKey: 'de-store' }, { ports, provider });

    // No mode requested → resolve with the store's persisted active environment (mode undefined).
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('de-store', undefined);
    expect(ports.paymentMethodsStore.readWithVersion).toHaveBeenCalledWith('de-store');
    expect(provider.introspection.availableMethods).toHaveBeenCalledTimes(1);
  });

  test('resolves the catalogue for the REQUESTED environment mode, not the persisted active one', async () => {
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
      .mockResolvedValue({ value: null, version: undefined });

    await getPaymentMethods({ env, storeKey: 'de-store', mode: 'live' }, { ports, provider });

    // The catalogue is read from the SELECTED env's keypair: the resolver is asked to resolve the
    // config forced to that mode, so a store whose active mode is sandbox still gets live's catalogue.
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('de-store', 'live');
  });

  test("merges the SELECTED environment's persisted config, not the other environment's", async () => {
    const baseCfg = await ports.configResolver.resolve('de-store');
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockImplementation(async (_key, mode) => ({ ...baseCfg, mode: mode ?? 'sandbox' }));
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
        value: storedObject({
          sandbox: [configured({ paymentMethodCode: 'card', surcharge: { EUR: 11 } })],
          live: [configured({ paymentMethodCode: 'card', surcharge: { EUR: 99 } })],
        }),
        version: 1,
      });

    const live = await getPaymentMethods({ env, storeKey: 'de-store', mode: 'live' }, { ports, provider });
    const sandbox = await getPaymentMethods({ env, storeKey: 'de-store', mode: 'sandbox' }, { ports, provider });

    // Each environment merges its OWN persisted config for the same catalogue code.
    expect(live.paymentMethods[0].surcharge).toEqual({ EUR: 99 });
    expect(sandbox.paymentMethods[0].surcharge).toEqual({ EUR: 11 });
  });
});

describe('updatePaymentMethods — CAS-write the per-store method config', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('persists the payload as the Custom Object value, threading the read version for CAS', async () => {
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: storedObject({ sandbox: [] }), version: 7 });

    const body = {
      paymentMethods: [configured({ paymentMethodCode: 'paypal', enabled: false, sendBasketData: true })],
    };
    await updatePaymentMethods({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(ports.paymentMethodsStore.readWithVersion).toHaveBeenCalledWith('de-store');
    expect(ports.paymentMethodsStore.write).toHaveBeenCalledTimes(1);
    const [storeKey, written, version] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
      string,
      PaymentMethodsObject,
      number | undefined,
    ];
    expect(storeKey).toBe('de-store');
    expect(version).toBe(7);
    expect(written.store).toBe('de-store');
    // No mode requested → written into the store's resolved active environment (sandbox in the fake).
    expect(written.environments.sandbox?.paymentMethods).toEqual(body.paymentMethods);
    // The merchant toggle is persisted; the derived `supportsAuthorize` is never part of the stored shape.
    expect(written.environments.sandbox?.paymentMethods[0].sendBasketData).toBe(true);
    expect(written.environments.sandbox?.paymentMethods[0]).not.toHaveProperty('supportsAuthorize');
  });

  test('writes ONLY the targeted environment, preserving the other environment config', async () => {
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({
        value: storedObject({ sandbox: [configured({ paymentMethodCode: 'card', surcharge: { EUR: 11 } })] }),
        version: 2,
      });

    const body = { paymentMethods: [configured({ paymentMethodCode: 'card', surcharge: { EUR: 99 } })] };
    await updatePaymentMethods({ env, body, storeKey: 'de-store', mode: 'live' }, { ports, provider });

    const [, written] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
      string,
      PaymentMethodsObject,
      number | undefined,
    ];
    // The targeted (live) environment gets the payload; the untouched sandbox config is carried through.
    expect(written.environments.live?.paymentMethods[0].surcharge).toEqual({ EUR: 99 });
    expect(written.environments.sandbox?.paymentMethods[0].surcharge).toEqual({ EUR: 11 });
  });

  test('a first write (no existing object) omits the version', async () => {
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });

    await updatePaymentMethods(
      { env, body: { paymentMethods: [configured()] }, storeKey: 'de-store' },
      { ports, provider },
    );

    const [, , version] = (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0] as [
      string,
      PaymentMethodsObject,
      number | undefined,
    ];
    expect(version).toBeUndefined();
  });

  test('rejects an X-Store-Key equal to the reserved project key; nothing persisted', async () => {
    await expect(
      updatePaymentMethods({ env, body: { paymentMethods: [configured()] }, storeKey: 'store-1' }, { ports, provider }),
    ).rejects.toThrow(/reserved|X-Store-Key/i);
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('an absent X-Store-Key (falls back to the reserved project key) is rejected; nothing persisted', async () => {
    await expect(
      updatePaymentMethods({ env, body: { paymentMethods: [configured()] } }, { ports, provider }),
    ).rejects.toThrow(/reserved|X-Store-Key/i);
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('rejects a payload whose paymentMethods is not an array with a 400; nothing persisted', async () => {
    await expect(
      updatePaymentMethods(
        { env, body: { paymentMethods: 'nope' as never }, storeKey: 'de-store' },
        { ports, provider },
      ),
    ).rejects.toThrow();
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('rejects a method whose minAmount exceeds its maxAmount with a 400; nothing persisted', async () => {
    const body = { paymentMethods: [configured({ minAmount: { EUR: 5000 }, maxAmount: { EUR: 100 } })] };

    await expect(updatePaymentMethods({ env, body, storeKey: 'de-store' }, { ports, provider })).rejects.toMatchObject({
      httpErrorStatus: 400,
    });
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('rejects min > max in ONE currency even when the other currencies are in range', async () => {
    const body = {
      paymentMethods: [configured({ minAmount: { EUR: 100, USD: 5000 }, maxAmount: { EUR: 500000, USD: 100 } })],
    };

    await expect(updatePaymentMethods({ env, body, storeKey: 'de-store' }, { ports, provider })).rejects.toMatchObject({
      httpErrorStatus: 400,
    });
    expect(ports.paymentMethodsStore.write).not.toHaveBeenCalled();
  });

  test('accepts a currency bounded on one side only (a min with no max, and the reverse)', async () => {
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });

    const body = { paymentMethods: [configured({ minAmount: { EUR: 5000 }, maxAmount: { USD: 100 } })] };
    await updatePaymentMethods({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(ports.paymentMethodsStore.write).toHaveBeenCalledTimes(1);
  });

  test('accepts a method whose minAmount equals its maxAmount (a single-amount offer)', async () => {
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });

    const body = { paymentMethods: [configured({ minAmount: { EUR: 1000 }, maxAmount: { EUR: 1000 } })] };
    await updatePaymentMethods({ env, body, storeKey: 'de-store' }, { ports, provider });

    expect(ports.paymentMethodsStore.write).toHaveBeenCalledTimes(1);
  });
});
/**
 * A wallet block belongs to ONE method code. Persisted on another it would sit in the object
 * describing nothing, and a reader would reasonably believe Apple Pay was configured - so the save is refused.
 */
describe('assertPaymentMethodRules — the wallet blocks', () => {
  const base = {
    enabled: true,
    name: {},
    description: {},
    surcharge: {},
    countries: [],
    sendBasketData: true,
  };

  test('accepts each block on its own method', () => {
    expect(() =>
      assertPaymentMethodRules([
        { ...base, paymentMethodCode: 'googlepay', googlePay: { merchantId: 'm-1' } },
        { ...base, paymentMethodCode: 'applepay', applePay: { label: 'Shop' } },
      ]),
    ).not.toThrow();
  });

  const refusals: Array<[string, string, Partial<PaymentMethodConfig>]> = [
    ['a Google block on Apple Pay', 'applepay', { googlePay: { merchantId: 'm-1' } }],
    ['an Apple block on Google Pay', 'googlepay', { applePay: { label: 'Shop' } }],
    ['a Google block on the card', 'card', { googlePay: { merchantId: 'm-1' } }],
  ];

  test.each(refusals)('refuses %s', (_case, paymentMethodCode, over) => {
    expect(() => assertPaymentMethodRules([{ ...base, paymentMethodCode, ...over }])).toThrow(/belongs to the/);
  });
});
/**
 * The connector's OWN field on a saved method: Google Pay's `gatewayMerchantId` is the Unzer channel,
 * which no merchant can type. The save reads the catalogue and stamps it, so the stored object is complete on
 * its own and the shopper path assembles the sheet without a vendor call.
 */
describe('updatePaymentMethods — the stamped gateway merchant id', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  const walletBody = (over: Record<string, unknown> = {}) => ({
    paymentMethods: [
      {
        paymentMethodCode: 'googlepay',
        enabled: true,
        name: {},
        description: {},
        surcharge: {},
        countries: [],
        sendBasketData: true,
        googlePay: { merchantName: 'Shop', ...over },
      },
    ],
  });
  const written = () => (ports.paymentMethodsStore.write as jest.Mock).mock.calls[0]![1] as PaymentMethodsObject;

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockResolvedValue([
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
  });

  test('stamps the channel onto the saved Google Pay block', async () => {
    await updatePaymentMethods({ env, storeKey: 'de-store', body: walletBody() } as never, { ports, provider });

    expect(written().environments.sandbox?.paymentMethods[0]?.googlePay).toMatchObject({
      merchantName: 'Shop',
      gatewayMerchantId: '9138634f404b',
    });
  });

  // A client may echo what it read; the server decides which channel is charged, so its value wins.
  test('overwrites a gateway merchant id the client sent', async () => {
    await updatePaymentMethods(
      { env, storeKey: 'de-store', body: walletBody({ gatewayMerchantId: 'made-up' }) } as never,
      {
        ports,
        provider,
      },
    );

    expect(written().environments.sandbox?.paymentMethods[0]?.googlePay?.gatewayMerchantId).toBe('9138634f404b');
  });

  // BEST-EFFORT: refusing a merchant's save because a decoration failed would be the worse outcome, and the
  // shopper path still falls back to the live channel.
  test('persists the save unchanged when the vendor read fails', async () => {
    provider.introspection.availableMethods = jest
      .fn<typeof provider.introspection.availableMethods>()
      .mockRejectedValue(new Error('vendor down'));

    await updatePaymentMethods({ env, storeKey: 'de-store', body: walletBody() } as never, { ports, provider });

    expect(written().environments.sandbox?.paymentMethods[0]?.googlePay).toEqual({ merchantName: 'Shop' });
  });

  // No wallet in the body, no vendor call: an ordinary save must not pay for a keypair probe.
  test('reads no catalogue for a save that carries no Google Pay method', async () => {
    await updatePaymentMethods(
      {
        env,
        storeKey: 'de-store',
        body: {
          paymentMethods: [
            {
              paymentMethodCode: 'card',
              enabled: true,
              name: {},
              description: {},
              surcharge: {},
              countries: [],
              sendBasketData: true,
            },
          ],
        },
      } as never,
      { ports, provider },
    );

    expect(provider.introspection.availableMethods).not.toHaveBeenCalled();
  });
});
