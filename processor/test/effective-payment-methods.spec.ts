/**
 * Which per-method configuration a store actually runs on. One source: the payment-methods Custom Object,
 * written ONLY by the merchant app, layered over the `__default__` scope by the store port.
 *
 * The consequence worth stating plainly: an existing object governs WHOLESALE, per environment set. A
 * merchant who saves sandbox in the app takes ownership of live too, which then holds whatever the object
 * says about live — including nothing. That is the rule, not an accident, and this suite pins it.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { PaymentMethodConfig, PaymentMethodsObject } from '../src/domain';
import { createPayment, effectiveMethods, getPaymentConfig, getPaymentMethods } from '../src/application/orchestration';
import { makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';

const configured = (over: Partial<PaymentMethodConfig> = {}): PaymentMethodConfig => ({
  paymentMethodCode: 'card',
  enabled: true,
  name: {},
  description: {},
  surcharge: {},
  countries: [],
  sendBasketData: false,
  ...over,
});

/** A payment-methods Custom Object holding the given per-environment lists. */
const object = (environments: {
  sandbox?: PaymentMethodConfig[];
  live?: PaymentMethodConfig[];
}): PaymentMethodsObject => ({
  store: 'store-1',
  environments: {
    ...(environments.sandbox ? { sandbox: { paymentMethods: environments.sandbox } } : {}),
    ...(environments.live ? { live: { paymentMethods: environments.live } } : {}),
  },
});

describe('effectiveMethods', () => {
  it('answers with no methods when the store has no Custom Object', () => {
    expect(effectiveMethods(null, 'sandbox')).toEqual([]);
    expect(effectiveMethods(undefined, 'sandbox')).toEqual([]);
  });

  it('uses the Custom Object once it exists', () => {
    const stored = object({ sandbox: [configured({ paymentMethodCode: 'from-app' })] });

    expect(effectiveMethods(stored, 'sandbox').map((m) => m.paymentMethodCode)).toEqual(['from-app']);
  });

  // The object governs WHOLESALE: an environment it says nothing about has no methods.
  it('answers with no methods for an environment the existing object does not configure', () => {
    const sandboxOnly = object({ sandbox: [configured({ paymentMethodCode: 'from-app' })] });

    expect(effectiveMethods(sandboxOnly, 'live')).toEqual([]);
  });

  // An empty list in the object is a merchant STATEMENT ("no methods here"), not an absence, so it stands.
  it('honours an empty list in the existing object', () => {
    expect(effectiveMethods(object({ sandbox: [] }), 'sandbox')).toEqual([]);
  });
});

/**
 * The DEFAULT-scope layer. A store that was never configured on its own runs on the methods the
 * merchant configured under `__default__` — the payment-methods twin of the connection layering,
 * so a store inheriting its CREDENTIALS from the default cannot end up inheriting no METHODS. The
 * `readEffective` port call is where that layering lives; all three read paths must go through it, or one
 * of them offers a method another refuses.
 */
describe('the DEFAULT scope reaches every read path', () => {
  const defaultScopeObject = object({ sandbox: [configured({ paymentMethodCode: 'card', enabled: true })] });

  /** Ports + provider for a store with NO object of its own, NO env baseline, and a configured default scope. */
  function inheritingFromDefault() {
    const ports = makeFakePorts();
    const provider = makeFakeProviderModule();
    // The store's own object does not exist; the effective read resolves to the default scope's.
    ports.paymentMethodsStore.readWithVersion = jest
      .fn<typeof ports.paymentMethodsStore.readWithVersion>()
      .mockResolvedValue({ value: null, version: undefined });
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(defaultScopeObject);
    // The store has no connection of its own either, which is what makes it inherit at all. Both
    // resolver legs say so: the shopper read reaches `resolveDefault` for a cart with no store.
    const base = makeFakePorts().configResolver;
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockImplementation(async (storeKey, mode) => ({
        ...(await base.resolve(storeKey, mode)),
        inheritsDefaultScope: true,
      }));
    ports.configResolver.resolveDefault = jest
      .fn<typeof ports.configResolver.resolveDefault>()
      .mockImplementation(async () => ({ ...(await base.resolveDefault()), inheritsDefaultScope: true }));
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
    return { ports, provider, env: makeFakeEnv() };
  }

  it('offers the default scope’s methods to the shopper', async () => {
    const { ports, provider, env } = inheritingFromDefault();

    const res = await getPaymentConfig({ env }, { ports, provider });

    expect(res.paymentMethods.map((m) => m.code)).toEqual(['card']);
    expect(ports.paymentMethodsStore.readEffective).toHaveBeenCalledWith('store-1', true);
  });

  it('shows the default scope’s methods as enabled in the merchant view', async () => {
    const { ports, provider, env } = inheritingFromDefault();

    const res = await getPaymentMethods({ env, storeKey: 'store-1' }, { ports, provider });

    expect(res.paymentMethods[0]).toMatchObject({ paymentMethodCode: 'card', enabled: true });
  });

  // The charge gate is the one that turns a mismatch into a shopper's failed payment, so it reads the same
  // layered source the offer did — not the store's own object alone.
  it('charges a method the default scope enabled', async () => {
    const { ports, provider, env } = inheritingFromDefault();

    await expect(
      createPayment(
        { env, data: { paymentMethodCode: 'card', resourceId: 's-crd-1', returnUrl: 'https://shop.test/return' } },
        { ports, provider },
      ),
    ).resolves.toMatchObject({ paymentReference: expect.any(String) });
  });

  // The store's OWN object still wins where it exists — inheritance is a fallback, not a merge. The port
  // resolves that; this pins that the surface honours what the port answered.
  it('lets the store’s own object override the default scope', async () => {
    const { ports, provider, env } = inheritingFromDefault();
    ports.paymentMethodsStore.readEffective = jest
      .fn<typeof ports.paymentMethodsStore.readEffective>()
      .mockResolvedValue(object({ sandbox: [] }));

    await expect(
      createPayment(
        { env, data: { paymentMethodCode: 'card', resourceId: 's-crd-1', returnUrl: 'https://shop.test/return' } },
        { ports, provider },
      ),
    ).rejects.toThrow(/not enabled/);
  });
});
