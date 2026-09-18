import { describe, expect, it, jest } from '@jest/globals';
import { storeConfig } from './support/store-config';
import { PspError } from '../src/providers/psp';
import { PspIntrospectionService } from '../src/providers/psp/introspection/introspection.service';
import type { PspClient, UnzerPayment } from '../src/providers/psp/client';

const service = new PspIntrospectionService();
const cfg = storeConfig();

/** A config carrying the Unzer keypair the connectivity probe validates (its only credentials). */
const unzerConfig = () => storeConfig({ credentials: { publicKey: 's-pub-test', privateKey: 's-priv-test' } });

/** The flat fake surface the cases stub — wrapped onto the client's resource composition below. */
type FlatClientOverrides = {
  validateKeypair?: PspClient['keypair']['validate'];
  getPayment?: PspClient['payments']['get'];
};

/** Build the service over a fake `PspClient` — every read is an injected Unzer call, no live account. */
function serviceWith(overrides: FlatClientOverrides): PspIntrospectionService {
  const validate = overrides.validateKeypair ?? (async () => ({ availableMethods: [], methodSupport: [] }));
  const get = overrides.getPayment ?? ((async () => ({ id: 'pay-1' }) as UnzerPayment) as PspClient['payments']['get']);
  return new PspIntrospectionService({
    keypair: { validate },
    payments: { get },
  } as Pick<PspClient, 'keypair' | 'payments'>);
}

describe('PspIntrospectionService — static advertisements', () => {
  it('advertises the one composite component - the enabler renders every MC-enabled method under it', () => {
    expect(service.supportedComponents()).toEqual([{ type: 'unzer' }]);
  });

  it('advertises the same list as the embedded drop-in, for the merchant who prefers that mode', () => {
    expect(service.supportedDropins()).toEqual([{ type: 'embedded' }]);
  });
});

describe('PspIntrospectionService — connectivity', () => {
  // `statusChecks` is the Unzer keypair probe (a 2xx keypair = reachable + valid credentials).
  it('statusChecks reports UP when the keypair validates', async () => {
    const [check] = await serviceWith({}).statusChecks(unzerConfig());
    expect(check.name).toContain('connectivity');
    expect(check.status).toBe('UP');
  });

  it('statusChecks reports DOWN (no throw, no secret leak) when the keypair is rejected', async () => {
    const svc = serviceWith({
      validateKeypair: async () => {
        throw new PspError('PSP API error: Access denied', 401);
      },
    });
    const checks = await svc.statusChecks(unzerConfig());
    expect(checks[0].status).toBe('DOWN');
    expect(JSON.stringify(checks)).not.toContain('s-priv-test');
  });

  it('testConnection returns { success:true } when the keypair validates', async () => {
    await expect(serviceWith({}).testConnection(cfg)).resolves.toEqual({ success: true });
  });

  it('testConnection returns { success:false, message } (secret-free) when the keypair is rejected', async () => {
    const svc = serviceWith({
      validateKeypair: async () => {
        throw new PspError('PSP API error: Access denied', 401);
      },
    });
    const result = await svc.testConnection(cfg);
    expect(result.success).toBe(false);
    expect(result.message).toBeTruthy();
  });

  // A 2xx keypair proves the PRIVATE key alone. The browser tokenizes with the PUBLIC key, and a type id
  // minted under a public key from a different Unzer keypair is refused at CHARGE time with
  // `API.330.200.145` "type id does not belong to merchant" — a shopper-facing refusal caused by a
  // configuration error. The keypair read carries the account's own public key, so the mismatch is
  // detectable at connect time, which is where a merchant can still fix it.
  it('testConnection fails when the account public key is not the configured one', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: [], methodSupport: [], publicKey: 's-pub-OTHER-MERCHANT' }),
    });

    const result = await svc.testConnection(unzerConfig());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/public key/i);
    // Neither key value is echoed: the message says WHAT is wrong, not what the secrets are.
    expect(result.message).not.toContain('s-priv-test');
    expect(result.message).not.toContain('s-pub-OTHER-MERCHANT');
  });

  it('testConnection succeeds when the account public key is the configured one', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: [], methodSupport: [], publicKey: 's-pub-test' }),
    });

    await expect(svc.testConnection(unzerConfig())).resolves.toEqual({ success: true });
  });

  // An account that reports no public key cannot be checked; the 2xx still proved the private key, so a
  // missing field must not be turned into a failure the merchant cannot act on.
  it('testConnection succeeds when the account reports no public key to compare', async () => {
    const svc = serviceWith({ validateKeypair: async () => ({ availableMethods: [], methodSupport: [] }) });

    await expect(svc.testConnection(unzerConfig())).resolves.toEqual({ success: true });
  });

  // A mismatch is attributable: the merchant typed a public key from another account, so the failure names
  // the field the config screen can mark instead of leaving the operator to guess which of the two is wrong.
  it('testConnection attributes a keypair mismatch to the public-key field', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: [], methodSupport: [], publicKey: 's-pub-OTHER-MERCHANT' }),
    });

    const result = await svc.testConnection(unzerConfig());

    expect(result.success).toBe(false);
    expect(result.field).toBe('credentials.publicKey');
    expect(result.message).toMatch(/public key/i);
  });

  // A transport failure is not attributable to one field: nothing about the key pair is known to be wrong,
  // so naming one would mark a field the merchant may have entered correctly.
  it('testConnection attributes an unreachable vendor to no field at all', async () => {
    const svc = serviceWith({
      validateKeypair: async () => {
        throw new PspError('PSP request failed: socket hang up', 502);
      },
    });

    const result = await svc.testConnection(unzerConfig());

    expect(result.success).toBe(false);
    expect(result.field).toBeUndefined();
  });

  it('statusChecks reports DOWN on a mismatched keypair, so the health check agrees with the test button', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: [], methodSupport: [], publicKey: 's-pub-OTHER-MERCHANT' }),
    });

    const [check] = await svc.statusChecks(unzerConfig());

    expect(check.status).toBe('DOWN');
    expect(check.message).toMatch(/public key/i);
  });

  // The payment-methods catalogue seam: `availableMethods` pairs each keypair
  // `availablePaymentTypes` code with its two-step (`supportsAuthorize`) capability.
  it('availableMethods pairs each keypair catalogue code with its two-step capability', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: ['card', 'paypal', 'przelewy24'], methodSupport: [] }),
    });
    // Answered in the connector's DISPLAY order, not the order the keypair listed them in.
    await expect(svc.availableMethods(cfg)).resolves.toEqual([
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
        code: 'przelewy24',
        supportsAuthorize: false,
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
  });

  /**
   * The keypair answers in no order an operator would recognise, and BOTH lists that read this catalogue
   * render it as it arrives — so the order is imposed here, once. Reversing the vendor's answer
   * is what makes this a test of the order rather than of the input.
   */
  it('answers in the connector display order, whatever order the vendor listed', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({
        availableMethods: ['wechatpay', 'paypal', 'card', 'klarna', 'applepay', 'paylater-invoice'],
        methodSupport: [],
      }),
    });

    await expect(svc.availableMethods(cfg).then((methods) => methods.map((m) => m.code))).resolves.toEqual([
      'paylater-invoice',
      'card',
      'applepay',
      'klarna',
      'paypal',
      'wechatpay',
    ]);
  });

  /**
   * An account may serve types this release never implemented — `giropay` and `sofort` are live examples —
   * and a known code may still have no surface (`installment-secured`, the retired predecessor of the
   * paylater family). Both used to reach the merchant screen and the shopper's list, where selecting one
   * answered `Component type not supported`. The catalogue boundary is the one place that decides what is
   * offered, so it is where they are dropped.
   */
  it('availableMethods drops a code this connector cannot offer, whatever the account serves', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({
        availableMethods: ['giropay', 'card', 'sofort', 'installment-secured', 'a-type-added-later', 'payu'],
        methodSupport: [],
      }),
    });

    await expect(svc.availableMethods(cfg).then((methods) => methods.map((m) => m.code))).resolves.toEqual([
      'card',
      'payu',
    ]);
  });

  /**
   * The two transaction capabilities are INDEPENDENT, so the catalogue carries both: Klarna accepts only an
   * authorization (a charge answers `500 API.000.000.999`) while iDEAL accepts only a charge (an authorize
   * answers `405 API.320.000.004`). The merchant app offers the booking-mode choice only where both are
   * true, and the charge path books the possible one regardless of what is configured.
   */
  it('availableMethods states BOTH transaction capabilities per method', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({ availableMethods: ['klarna', 'ideal', 'card'], methodSupport: [] }),
    });

    await expect(svc.availableMethods(cfg)).resolves.toEqual([
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
        code: 'klarna',
        supportsAuthorize: true,
        supportsCharge: false,
        countries: [],
        currencies: [],
        customerTypes: [],
        cardNetworks: [],
      },
      {
        code: 'ideal',
        supportsAuthorize: false,
        supportsCharge: true,
        countries: [],
        currencies: [],
        customerTypes: [],
        cardNetworks: [],
      },
    ]);
  });

  // Click to Pay is NOT a method of its own here: the connector carries it as the card method's
  // `clickToPayEnabled` flag, so the catalogue must never offer a second row for the same setting
  //. The match is normalized, because the vendor's spelling of the code is not dependable.
  it('availableMethods drops Click to Pay however the vendor spells it, keeping card', async () => {
    for (const spelling of ['click-to-pay', 'clicktopay', 'Click To Pay', 'CLICK_TO_PAY']) {
      const svc = serviceWith({
        validateKeypair: async () => ({ availableMethods: [spelling, 'card', 'paypal'], methodSupport: [] }),
      });

      await expect(svc.availableMethods(cfg).then((methods) => methods.map((m) => m.code))).resolves.toEqual([
        'card',
        'paypal',
      ]);
    }
  });

  // The catalogue is what the shopper-facing filter intersects against, so each entry has to carry the
  // vendor's own coverage for that method — the account-level code list cannot answer "may this method be
  // charged for a DE cart in EUR".
  it('availableMethods carries the vendor country/currency coverage per method', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({
        availableMethods: ['card', 'paylater-invoice'],
        methodSupport: [
          { code: 'card', countries: [], currencies: [], customerTypes: [], brands: [] },
          { code: 'paylater-invoice', countries: ['DE', 'AT'], currencies: ['EUR'], customerTypes: [], brands: [] },
        ],
      }),
    });

    await expect(svc.availableMethods(cfg)).resolves.toEqual([
      {
        code: 'paylater-invoice',
        supportsAuthorize: true,
        supportsCharge: false,
        countries: ['DE', 'AT'],
        currencies: ['EUR'],
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
    ]);
  });

  // A code in the flat catalogue with no matching support entry is unrestricted, not unavailable: the
  // account may serve it and the vendor simply declared no coverage detail for it.
  it('availableMethods leaves a code with no support entry unrestricted', async () => {
    const svc = serviceWith({
      validateKeypair: async () => ({
        availableMethods: ['card'],
        methodSupport: [{ code: 'paypal', countries: ['DE'], currencies: ['EUR'], customerTypes: [], brands: [] }],
      }),
    });

    await expect(svc.availableMethods(cfg)).resolves.toEqual([
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
  });

  it('availableMethods propagates the typed PspError (secret-free) when the keypair is rejected', async () => {
    const svc = serviceWith({
      validateKeypair: async () => {
        throw new PspError('PSP API error: Access denied', 401);
      },
    });
    await expect(svc.availableMethods(cfg)).rejects.toBeInstanceOf(PspError);
  });
});

/**
 * The catalogue is static reference data read on EVERY shopper `getPaymentConfig` and merchant
 * `getPaymentMethods`; a per-instance TTL memo keyed by (storeKey, mode) collapses the repeated
 * `GET /v1/keypair` to one probe per store-environment per window. Only `availableMethods` is memoized —
 * `statusChecks`/`testConnection` are liveness probes and stay live.
 */
describe('PspIntrospectionService — availableMethods catalogue memo', () => {
  it('serves two calls within the TTL for the same (storeKey,mode) from ONE keypair probe', async () => {
    const validateKeypair = jest.fn(async () => ({ availableMethods: ['card'], methodSupport: [] }));
    const svc = serviceWith({ validateKeypair: validateKeypair as never });

    const first = await svc.availableMethods(storeConfig({ mode: 'sandbox' }));
    const second = await svc.availableMethods(storeConfig({ mode: 'sandbox' }));

    expect(second).toEqual(first);
    expect(validateKeypair).toHaveBeenCalledTimes(1);
  });

  it('re-probes once the TTL window has expired', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const validateKeypair = jest.fn(async () => ({ availableMethods: ['card'], methodSupport: [] }));
      const svc = serviceWith({ validateKeypair: validateKeypair as never });

      await svc.availableMethods(storeConfig({ mode: 'sandbox' }));
      nowSpy.mockReturnValue(1_000_000 + 120_000 + 1);
      await svc.availableMethods(storeConfig({ mode: 'sandbox' }));

      expect(validateKeypair).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keys the memo by environment — a different mode issues a fresh probe', async () => {
    const validateKeypair = jest.fn(async () => ({ availableMethods: ['card'], methodSupport: [] }));
    const svc = serviceWith({ validateKeypair: validateKeypair as never });

    await svc.availableMethods(storeConfig({ mode: 'sandbox' }));
    await svc.availableMethods(storeConfig({ mode: 'live' }));

    expect(validateKeypair).toHaveBeenCalledTimes(2);
  });

  it('keys the memo by store — a different storeKey at the same mode issues a fresh probe', async () => {
    const validateKeypair = jest.fn(async () => ({ availableMethods: ['card'], methodSupport: [] }));
    const svc = serviceWith({ validateKeypair: validateKeypair as never });

    await svc.availableMethods(storeConfig({ storeKey: 'store-a', mode: 'sandbox' }));
    await svc.availableMethods(storeConfig({ storeKey: 'store-b', mode: 'sandbox' }));

    expect(validateKeypair).toHaveBeenCalledTimes(2);
  });

  it('never memoizes connectivity — statusChecks and testConnection probe live every call', async () => {
    const validateKeypair = jest.fn(async () => ({ availableMethods: [], methodSupport: [] }));
    const svc = serviceWith({ validateKeypair: validateKeypair as never });

    await svc.statusChecks(cfg);
    await svc.statusChecks(cfg);
    await svc.testConnection(cfg);
    await svc.testConnection(cfg);

    expect(validateKeypair).toHaveBeenCalledTimes(4);
  });
});

/**
 * The merchant panel's single-payment read: EXACTLY ONE `GET /v1/payments/{id}` through the client
 * funnel, mapped onto the neutral contract — the coarse Unzer state plus the transaction legs.
 */
describe('PspIntrospectionService — paymentDetails', () => {
  const unzerPayment = (overrides: Partial<UnzerPayment> = {}): UnzerPayment => ({
    id: 'pay-unzer-1',
    state: { name: 'completed' },
    currency: 'EUR',
    transactions: [
      {
        type: 'charge',
        status: 'success',
        url: 'https://api.unzer.com/v1/payments/pay-unzer-1/charges/chg-1',
        amount: '25.00',
      },
    ],
    ...overrides,
  });

  it('reads via a single PspClient.getPayment and maps state + legs', async () => {
    const getPayment = jest.fn(async () => unzerPayment());
    const svc = serviceWith({ getPayment: getPayment as never });

    const details = await svc.paymentDetails(cfg, 'pay-unzer-1');

    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(details.displayStatus).toBe('completed');
    expect(details.operations).toEqual([
      {
        id: 'chg-1',
        type: 'charge',
        outcome: 'success',
        amount: { centAmount: 2500, currencyCode: 'EUR' },
        rawStatus: { state: 'CAPTURED' },
      },
    ]);
  });

  it('yields a bare status with an empty operation list for a payment with no legs', async () => {
    const svc = serviceWith({
      getPayment: (async () => unzerPayment({ state: { name: 'pending' }, transactions: undefined })) as never,
    });

    const details = await svc.paymentDetails(cfg, 'pay-unzer-1');

    expect(details.displayStatus).toBe('pending');
    expect(details.operations).toEqual([]);
  });

  it('surfaces a non-2xx Unzer read as a typed PspError (the orchestration degrades it)', async () => {
    const svc = serviceWith({
      getPayment: (async () => {
        throw new PspError('PSP API error: payment not found', 404);
      }) as never,
    });

    const error = await svc.paymentDetails(cfg, 'pay_missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PspError);
    expect((error as PspError).statusCode).toBe(404);
  });
});
