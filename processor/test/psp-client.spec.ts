/**
 * The Unzer vendor client's own contract.
 *
 * `psp-client.ts` is the single transport funnel every Unzer HTTP call passes through. This suite pins the three connection
 * calls the config feature needs - keypair validation, webhook registration, webhook deletion - and
 * the funnel discipline the vendor client owes: HTTP Basic auth built
 * from the PRIVATE key, base URL derived from `mode`, a hard deadline that raises a 504-typed
 * `PspError`, and every non-2xx / transport failure surfacing as `PspError` with NO secret in the
 * message and NO raw Unzer body escaping.
 *
 * `fetch` is the transport, so it is the seam the
 * suite stubs - there is no live Unzer account in a unit run.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PspError } from '../src/providers/psp';
import { fractionDigitsForCurrency, fromDecimalAmount, PspClient, toDecimalAmount } from '../src/providers/psp/client';
import type { PspConnectionConfig, UnzerPaymentInput } from '../src/providers/psp/client';

const PRIVATE_KEY = 's-priv-test-3f9c1a7b2e';
const PUBLIC_KEY = 's-pub-test-11aa22bb';

/** A resolved connection config the client runs on (credentials + active environment + deadline). */
function config(overrides: Partial<PspConnectionConfig> = {}): PspConnectionConfig {
  return {
    mode: 'sandbox',
    hosts: { sandbox: 'https://sbx-api.unzer.com', live: 'https://api.unzer.com' },
    credentials: { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY },
    requestTimeoutMs: 30_000,
    ...overrides,
  };
}

/** A minimal stand-in for the parts of `Response` the client reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The captured `fetch(url, init)` of the Nth call. */
function fetchCall(n = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, init };
}

const fetchMock = jest.fn<typeof fetch>();
let originalFetch: typeof fetch;
let client: PspClient;

beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  client = new PspClient();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('validateKeypair', () => {
  it('returns the available payment method type codes on a 2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: ['card', 'paypal', 'sofort'] }));

    const result = await client.keypair.validate(config());

    expect(result.availableMethods).toEqual(['card', 'paypal', 'sofort']);
  });

  // The DETAILED keypair. `/v1/keypair` answers with the flat `availablePaymentTypes` alone, which is an
  // ACCOUNT-level list and says nothing about which country or currency a method is served for; the
  // `/types` variant answers with the same envelope PLUS `paymentTypes[].supports[]`, which is the only
  // place the vendor states that per-method coverage. It is the same single call, so nothing costs more.
  it('GETs /v1/keypair/types with HTTP Basic auth built from the PRIVATE key and an empty password', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: [] }));

    await client.keypair.validate(config());

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/keypair/types');
    expect(init.method).toBe('GET');
    const expected = `Basic ${Buffer.from(`${PRIVATE_KEY}:`).toString('base64')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expected);
  });

  it('derives the base host from the mode: live hits the production host', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: [] }));

    await client.keypair.validate(config({ mode: 'live' }));

    expect(fetchCall().url).toBe('https://api.unzer.com/v1/keypair/types');
  });

  it('reads the per-method country and currency support the account declares', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        availablePaymentTypes: ['card', 'paylater-invoice'],
        paymentTypes: [
          { type: 'card', supports: [{ countries: [], currency: [] }] },
          { type: 'paylater-invoice', supports: [{ countries: ['DE', 'AT'], currency: ['EUR'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: [], currencies: [], customerTypes: [], brands: [] },
      { code: 'paylater-invoice', countries: ['DE', 'AT'], currencies: ['EUR'], customerTypes: [], brands: [] },
    ]);
  });

  /**
   * `allowCustomerTypes` - the THIRD coverage axis, and the vendor states it on the TYPE rather than inside
   * `supports`, as ONE comma-joined string. A live account lists the instalment and the SEPA mandate as `B2C`
   * only, which is what stops them being offered to a shopper buying for a company.
   */
  it('reads the payer kinds the account declares per method', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'paylater-installment', allowCustomerTypes: 'B2C', supports: [{ currency: ['EUR'] }] },
          { type: 'card', allowCustomerTypes: 'B2B,B2C', supports: [{ currency: ['EUR'] }] },
          { type: 'paypal', supports: [{ currency: ['EUR'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport.map((m) => [m.code, m.customerTypes])).toEqual([
      ['paylater-installment', ['B2C']],
      ['card', ['B2B', 'B2C']],
      // Nothing stated means BOTH kinds - the same "empty is unrestricted" convention the other axes use.
      ['paypal', []],
    ]);
  });

  // The vendor's own CARD BRANDS, unioned per type: the wallets offer only networks the account holds.
  it('reads the card brands the account declares per method', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'googlepay', supports: [{ brands: ['MASTER', 'VISA'], currency: ['EUR'] }] },
          {
            type: 'card',
            supports: [
              { brands: ['JCB'], currency: ['JPY'] },
              { brands: ['VISA'], currency: ['EUR'] },
            ],
          },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport.map((m) => [m.code, m.brands])).toEqual([
      ['googlepay', ['MASTER', 'VISA']],
      ['card', ['JCB', 'VISA']],
    ]);
  });

  // The vendor CHANNEL: Google Pay needs it as its `gatewayMerchantId`, and it is the only reader.
  it('reads the vendor channel off the first supports block', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [{ type: 'googlepay', supports: [{ channel: '9138634f404b', currency: ['EUR'] }] }],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport[0]).toMatchObject({ code: 'googlepay', channel: '9138634f404b' });
  });

  // A type the vendor states no coverage for is read as UNRESTRICTED, not as unavailable: an empty
  // `countries`/`currency` array already means "no restriction", so an absent `supports` block saying the
  // same thing must not be the one shape that hides a method the account can serve.
  it.each([
    ['an absent supports block', { type: 'card' }],
    ['an empty supports array', { type: 'card', supports: [] }],
    ['a supports entry with neither list', { type: 'card', supports: [{}] }],
  ])('reads %s as unrestricted', async (_case, entry) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: ['card'], paymentTypes: [entry] }));

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: [], currencies: [], customerTypes: [], brands: [] },
    ]);
  });

  it('answers with an empty support matrix when the response carries no paymentTypes at all', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: ['card'] }));

    await expect(client.keypair.validate(config())).resolves.toMatchObject({ methodSupport: [] });
  });

  // OBSERVED on the live sandbox: the two variants of this endpoint return DISJOINT catalogue fields.
  // `GET /v1/keypair` carries `availablePaymentTypes` and no `paymentTypes`; `GET /v1/keypair/types`
  // carries `paymentTypes` and NO `availablePaymentTypes` - even though the vendor's OpenAPI document
  // shared `KeyPairResponse` for both. Reading only the flat field therefore yields an EMPTY catalogue,
  // and an empty catalogue silently empties the merchant methods list and the shopper's method list.
  it('derives the method codes from paymentTypes when the response carries no availablePaymentTypes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'card', supports: [{ countries: [], currency: ['EUR'] }] },
          { type: 'paypal', supports: [{ countries: [], currency: ['EUR'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.availableMethods).toEqual(['card', 'paypal']);
  });

  it('takes the code universe as the union of both catalogue fields when both are present', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        availablePaymentTypes: ['card', 'sofort'],
        paymentTypes: [{ type: 'card' }, { type: 'twint' }],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.availableMethods).toEqual(['card', 'sofort', 'twint']);
  });

  // OBSERVED on the live sandbox: `card` appears TWICE in `paymentTypes`, one entry supporting `JPY`
  // alone and the other twelve currencies including `EUR`. One entry per type is therefore not the
  // vendor's model, and reading a single entry would restrict card to whichever half came first - a EUR
  // cart would be refused the method the account plainly serves for EUR. The coverage of a type is the
  // UNION over every entry the vendor lists for it.
  it('unions the coverage of a type the vendor lists more than once', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'card', supports: [{ countries: ['JP'], currency: ['JPY'] }] },
          { type: 'card', supports: [{ countries: ['DE', 'AT'], currency: ['EUR', 'CHF'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: ['JP', 'DE', 'AT'], currencies: ['JPY', 'EUR', 'CHF'], customerTypes: [], brands: [] },
    ]);
  });

  // `supports` is a LIST because the vendor models coverage per channel and brand. Every block of it
  // states coverage the account has, so all of them count - reading `supports[0]` alone would drop the
  // rest of a type's markets.
  it('unions every supports block of one entry, not just the first', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          {
            type: 'card',
            supports: [
              { countries: ['DE'], currency: ['EUR'] },
              { countries: ['CH'], currency: ['CHF'] },
            ],
          },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: ['DE', 'CH'], currencies: ['EUR', 'CHF'], customerTypes: [], brands: [] },
    ]);
  });

  // Unrestricted WINS over a restriction: an empty list is the vendor saying "no restriction on this
  // axis", so a type carrying one such block is served everywhere on that axis whatever its other
  // blocks enumerate. Narrowing it to the union of the enumerated values would withhold markets the
  // account serves.
  it('opens only the axis the empty list names, leaving the other axis a union', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'card', supports: [{ countries: ['JP'], currency: ['JPY'] }] },
          { type: 'card', supports: [{ countries: ['DE'], currency: [] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    // The empty `currency` opens currencies; `countries` was enumerated in BOTH blocks, so it stays a union.
    expect(result.methodSupport).toEqual([
      { code: 'card', countries: ['JP', 'DE'], currencies: [], customerTypes: [], brands: [] },
    ]);
  });

  // The same rule, with the blocks in the OTHER order - which is the order the vendor's data decides, not
  // this connector. A restricted block states coverage the account ALSO holds, so it can only ADD values;
  // letting it replace an earlier unrestricted block would narrow a method the account serves everywhere
  // down to the one market that block names, and refuse every cart outside it.
  it('keeps both axes open when the unrestricted block precedes a restricted one', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'card', supports: [{ countries: [], currency: [] }] },
          { type: 'card', supports: [{ countries: ['DE'], currency: ['EUR'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: [], currencies: [], customerTypes: [], brands: [] },
    ]);
  });

  it('reads an entry with no supports block at all as unrestricted on both axes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [{ type: 'card', supports: [{ countries: ['JP'], currency: ['JPY'] }] }, { type: 'card' }],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport).toEqual([
      { code: 'card', countries: [], currencies: [], customerTypes: [], brands: [] },
    ]);
  });

  it('answers exactly one support entry per distinct type', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        paymentTypes: [
          { type: 'card', supports: [{ currency: ['EUR'] }] },
          { type: 'card', supports: [{ currency: ['USD'] }] },
          { type: 'twint', supports: [{ currency: ['CHF'] }] },
        ],
      }),
    );

    const result = await client.keypair.validate(config());

    expect(result.methodSupport.map((entry) => entry.code)).toEqual(['card', 'twint']);
  });

  // The pair check added for `API.330.200.145` reads the account's own public key, and it reads it from
  // THIS response - so moving to the detailed variant must not cost that field.
  it('still carries the account public key the keypair-pair check compares', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { availablePaymentTypes: [], publicKey: 's-pub-account' }));

    await expect(client.keypair.validate(config())).resolves.toMatchObject({ publicKey: 's-pub-account' });
  });

  it('throws a PspError carrying the transport status on a 401', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { id: 's-err-1', errors: [{ code: 'API.010.310.003', merchantMessage: 'Access denied' }] }),
    );

    try {
      await client.keypair.validate(config());
      throw new Error('expected validateKeypair to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PspError);
      expect((e as PspError).statusCode).toBe(401);
      // The operator-facing merchant message survives; the private key never does.
      expect((e as PspError).message).toContain('Access denied');
      expect((e as PspError).message).not.toContain(PRIVATE_KEY);
    }
  });

  it('throws a PspError on any other 4xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: [{ code: 'API.320.100.007' }] }));

    await expect(client.keypair.validate(config())).rejects.toBeInstanceOf(PspError);
  });

  it('maps a transport rejection to a 502-typed PspError with NO secret in the message', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED sbx-api.unzer.com:443'));

    try {
      await client.keypair.validate(config());
      throw new Error('expected validateKeypair to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PspError);
      expect((e as PspError).statusCode).toBe(502);
      expect((e as PspError).message).not.toContain(PRIVATE_KEY);
    }
  });

  it('races the call against requestTimeoutMs and raises a 504-typed PspError naming the deadline', async () => {
    jest.useFakeTimers();
    // A hung vendor: the fetch settles only when the client aborts its own signal.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }) as Promise<Response>,
    );

    const promise = client.keypair.validate(config({ requestTimeoutMs: 1234 }));
    // Attach the rejection handler BEFORE advancing the clock, so the abort's rejection is never
    // momentarily unhandled.
    const assertion = expect(promise).rejects.toMatchObject({
      statusCode: 504,
      message: expect.stringContaining('1234ms'),
    });
    await jest.advanceTimersByTimeAsync(1234);
    await assertion;
  });
});

describe('registerWebhooks', () => {
  it('POSTs the event URL to /v1/webhooks under an eventList and returns the created ids', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        events: [
          { id: 'wh-1', url: 'https://proc.example/webhooks/store-1', event: 'authorize.succeeded' },
          { id: 'wh-2', url: 'https://proc.example/webhooks/store-1', event: 'charge.succeeded' },
        ],
      }),
    );

    // Returns the created subscription ids - core records them so a later delete targets exactly these
    // subscriptions instead of the whole keypair.
    await expect(
      client.webhooks.register(config(), {
        url: 'https://proc.example/webhooks/store-1',
        events: ['authorize.succeeded', 'charge.succeeded'],
      }),
    ).resolves.toEqual(['wh-1', 'wh-2']);
    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/webhooks');
    expect(init.method).toBe('POST');
    // Exactly the asked-for names, never `all`: one subscription per name, all on the same URL.
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'https://proc.example/webhooks/store-1',
      eventList: ['authorize.succeeded', 'charge.succeeded'],
    });
  });

  // A single-event registration answers with ONE object rather than an `events` list; the same parser
  // reads both, so the caller still gets a flat list of ids to delete by later.
  it('reads the single-object response shape as one id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { id: 'wh-9', url: 'https://proc.example/hook', event: 'chargeback' }),
    );

    await expect(
      client.webhooks.register(config(), { url: 'https://proc.example/hook', events: ['chargeback'] }),
    ).resolves.toEqual(['wh-9']);
  });

  it('surfaces a non-2xx as a PspError (nothing registered)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { errors: [{ code: 'API.510.310.016' }] }));

    await expect(
      client.webhooks.register(config(), { url: 'https://proc.example/hook', events: ['charge.succeeded'] }),
    ).rejects.toBeInstanceOf(PspError);
  });
});

describe('deleteWebhooks', () => {
  it('issues a DELETE against /v1/webhooks and resolves void', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { events: [] }));

    await expect(client.webhooks.delete(config())).resolves.toBeUndefined();

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/webhooks');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces a non-2xx as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { errors: [{ code: 'COR.000.000.000' }] }));

    await expect(client.webhooks.delete(config())).rejects.toBeInstanceOf(PspError);
  });
});

/** A charge/authorize input: the browser-tokenized type id, amount (minor units), and the references. */
function paymentInput(overrides: Partial<UnzerPaymentInput> = {}): UnzerPaymentInput {
  return {
    resourceId: 's-crd-abcdef123456',
    amount: { centAmount: 1299, currencyCode: 'EUR' },
    fractionDigits: 2,
    returnUrl: 'https://proc.example/return/store-1',
    orderId: 'order-42',
    paymentReference: 'psp-ref-42',
    ...overrides,
  };
}

describe('decimal amount exponent (per-currency minor units)', () => {
  it('serializes a 2-exponent (EUR) amount unchanged - integer math, no float', () => {
    expect(toDecimalAmount(1099, 2)).toBe('10.99');
    expect(toDecimalAmount(5, 2)).toBe('0.05');
    expect(toDecimalAmount(-1010, 2)).toBe('-10.10');
  });

  it('serializes a 0-exponent (JPY) amount with no decimals and round-trips', () => {
    expect(toDecimalAmount(1000, 0)).toBe('1000');
    expect(fromDecimalAmount('1000', 'JPY', 0)).toEqual({ centAmount: 1000, currencyCode: 'JPY' });
  });

  it('serializes a 3-exponent (BHD) amount with three decimals and round-trips', () => {
    expect(toDecimalAmount(1000, 3)).toBe('1.000');
    expect(fromDecimalAmount('1.000', 'BHD', 3)).toEqual({ centAmount: 1000, currencyCode: 'BHD' });
  });

  it('resolves the currency minor-unit exponent (EUR=2 default, JPY=0, BHD=3)', () => {
    expect(fractionDigitsForCurrency('EUR')).toBe(2);
    expect(fractionDigitsForCurrency('JPY')).toBe(0);
    expect(fractionDigitsForCurrency('BHD')).toBe(3);
  });
});

/** A minimal Unzer payment body (charge/authorize + getPayment share this shape). */
const UNZER_PAYMENT_BODY = {
  id: 's-pay-9f8e7d',
  state: { id: 1, name: 'completed' },
  resources: { typeId: 's-crd-abcdef123456', customerId: 's-cst-11' },
  transactions: [{ type: 'charge', url: 'https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d/charges/s-chg-1' }],
  processing: { uniqueId: '31HA07BC...', shortId: '4711.7856.1234' },
};

describe('charge', () => {
  // The path is PLURAL (`charges`), as Unzer's own OpenAPI document declares (`POST
  // /{version}/payments/charges`). A singular `/v1/payments/charge` binds `charge` as the `{paymentId}`
  // of the GET-only `/{version}/payments/{paymentId}` route, so Unzer answers 405 API.310.000.006
  // "Http POST method is not supported" and no payment is ever created.
  it('POSTs /v1/payments/charges with Basic auth from the PRIVATE key and the resource id under resources.typeId', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput());

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/charges');
    expect(init.method).toBe('POST');
    const expectedAuth = `Basic ${Buffer.from(`${PRIVATE_KEY}:`).toString('base64')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      amount: '12.99',
      currency: 'EUR',
      returnUrl: 'https://proc.example/return/store-1',
      orderId: 'order-42',
      paymentReference: 'psp-ref-42',
      resources: { typeId: 's-crd-abcdef123456' },
    });
    // The PRIVATE key travels only in the Authorization header, never in the wire body.
    expect(init.body as string).not.toContain(PRIVATE_KEY);
  });

  /**
   * OBSERVED on the live sandbox: Unzer answers a DECLINED transaction with **HTTP 200** and an `errors`
   * array, not with a 4xx. Charging an iDEAL type for a shopper whose billing country is Germany returned
   * `200` carrying `COR.100.400.021 "transaction declined for country"` and NO `resources` block. Treating
   * every 2xx as success turned that refusal into the generic 502 "PSP charge response carried no payment
   * id" - a message that blames the connector for a decision the vendor made and reported, and that hides
   * the reason from the operator. The reference integration reads the same body the same way: its SDK
   * raises `UnzerApiException` from a response carrying `errors`, and the command surfaces the vendor's own
   * merchant/client message.
   */
  it('treats a 2xx carrying an errors array as a vendor REFUSAL, with the vendor code and message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: 's-err-1',
        isError: true,
        errors: [
          {
            code: 'COR.100.400.021',
            merchantMessage: 'transaction declined for country',
            customerMessage: 'Your payment was not successful.',
          },
        ],
      }),
    );

    await expect(client.payments.charge(config(), paymentInput())).rejects.toMatchObject({
      name: 'PspError',
      statusCode: 200,
      vendorErrors: [{ code: 'COR.100.400.021', message: 'transaction declined for country' }],
    });
  });

  it('carries the vendor errorId of a 2xx refusal for support correlation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: 's-err-42', errors: [{ code: 'COR.100.400.021', merchantMessage: 'declined' }] }),
    );

    await expect(client.payments.charge(config(), paymentInput())).rejects.toMatchObject({ errorId: 's-err-42' });
  });

  // `isError: false` rides on EVERY successful charge, and a pending redirect leg is not an error either,
  // so only a populated `errors` array or an explicit `isError: true` may refuse.
  it.each([
    ['isError false with no errors array', { ...UNZER_PAYMENT_BODY, isError: false }],
    ['an empty errors array', { ...UNZER_PAYMENT_BODY, errors: [] }],
  ])('accepts a 2xx carrying %s', async (_case, body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body));

    await expect(client.payments.charge(config(), paymentInput())).resolves.toMatchObject({ id: 's-pay-9f8e7d' });
  });

  it('sends an Idempotency-Key equal to the paymentReference so a retried charge is the SAME operation', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput({ paymentReference: 'psp-ref-idem-1' }));

    expect((fetchCall().init.headers as Record<string, string>)['Idempotency-Key']).toBe('psp-ref-idem-1');
  });

  it('formats the minor-unit amount as a major-unit decimal string with integer math (no float rounding)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput({ amount: { centAmount: 700, currencyCode: 'EUR' } }));
    expect(JSON.parse(fetchCall(0).init.body as string).amount).toBe('7.00');

    await client.payments.charge(config(), paymentInput({ amount: { centAmount: 5, currencyCode: 'EUR' } }));
    expect(JSON.parse(fetchCall(1).init.body as string).amount).toBe('0.05');

    await client.payments.charge(config(), paymentInput({ amount: { centAmount: 1010, currencyCode: 'EUR' } }));
    expect(JSON.parse(fetchCall(2).init.body as string).amount).toBe('10.10');
  });

  it('serializes a JPY (0-exponent) amount as a bare integer, never a 2-decimal string (no 100x undercharge)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(
      config(),
      paymentInput({ amount: { centAmount: 1000, currencyCode: 'JPY' }, fractionDigits: 0 }),
    );

    const body = JSON.parse(fetchCall().init.body as string);
    expect(body.amount).toBe('1000');
    expect(body.currency).toBe('JPY');
  });

  // Every linked resource travels as an ID under `resources` - the `PaymentLinkedData` shape Unzer
  // publishes (`customerId`, `typeId`, `basketId`, `metadataId`). `PaymentRequest` has no `basket`
  // property at all, so an embedded basket object is silently dropped by the vendor.
  it('links the customer, basket and metadata resources by id under resources', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(
      config(),
      paymentInput({ customerId: 's-cst-77', basketId: 's-bsk-55', metadataId: 's-mtd-33' }),
    );

    const body = JSON.parse(fetchCall().init.body as string);
    expect(body.resources).toEqual({
      typeId: 's-crd-abcdef123456',
      customerId: 's-cst-77',
      basketId: 's-bsk-55',
      metadataId: 's-mtd-33',
    });
    expect(body).not.toHaveProperty('basket');
  });

  it('omits every optional linked resource when the input does not carry one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput());

    const body = JSON.parse(fetchCall().init.body as string);
    expect(body.resources).toEqual({ typeId: 's-crd-abcdef123456' });
    expect(body).not.toHaveProperty('additionalTransactionData');
  });

  // The device-fingerprint id and the recurring-use marker both live under
  // The device-fingerprint id rides `additionalTransactionData.riskData`, never the top level: that is the
  // vendor's own risk-data field, and the block is omitted entirely when there is nothing to put in it.
  it('sends the ThreatMetrix id under additionalTransactionData.riskData', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput({ threatMetrixId: 'tmx-9f1c' }));

    const body = JSON.parse(fetchCall().init.body as string);
    expect(body.additionalTransactionData).toEqual({ riskData: { threatMetrixId: 'tmx-9f1c' } });
    expect(body).not.toHaveProperty('threatMetrixId');
  });

  it('omits additionalTransactionData entirely when no fingerprint id was collected', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.charge(config(), paymentInput());

    expect(JSON.parse(fetchCall().init.body as string)).not.toHaveProperty('additionalTransactionData');
  });

  it('returns the typed Unzer payment (id, state, redirectUrl) on a 2xx', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { ...UNZER_PAYMENT_BODY, redirectUrl: 'https://sbx-api.unzer.com/3ds/challenge' }),
    );

    const payment = await client.payments.charge(config(), paymentInput());

    expect(payment.id).toBe('s-pay-9f8e7d');
    expect(payment.state?.name).toBe('completed');
    expect(payment.redirectUrl).toBe('https://sbx-api.unzer.com/3ds/challenge');
  });

  it('surfaces a non-2xx as a PspError carrying the transport status; no raw body escapes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { id: 's-err-2', errors: [{ code: 'API.320.100.007', merchantMessage: 'invalid type id' }] }),
    );

    try {
      await client.payments.charge(config(), paymentInput());
      throw new Error('expected charge to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PspError);
      expect((e as PspError).statusCode).toBe(400);
      expect((e as PspError).message).toContain('invalid type id');
    }
  });
});

describe('authorize', () => {
  it('POSTs /v1/payments/authorize with the same body shape as charge', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    const payment = await client.payments.authorize(config(), paymentInput());

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/authorize');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: '12.99',
      resources: { typeId: 's-crd-abcdef123456' },
    });
    expect(payment.id).toBe('s-pay-9f8e7d');
  });

  it('sends an Idempotency-Key equal to the paymentReference', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_PAYMENT_BODY));

    await client.payments.authorize(config(), paymentInput({ paymentReference: 'psp-ref-idem-2' }));

    expect((fetchCall().init.headers as Record<string, string>)['Idempotency-Key']).toBe('psp-ref-idem-2');
  });
});

describe('getPayment', () => {
  it('GETs /v1/payments/{id} (URL-encoded) and returns the typed payment', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, UNZER_PAYMENT_BODY));

    const payment = await client.payments.get(config(), 's-pay-9f8e7d');

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d');
    expect(init.method).toBe('GET');
    expect(payment.resources?.typeId).toBe('s-crd-abcdef123456');
  });

  it('surfaces a non-2xx as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { errors: [{ code: 'API.320.000.005' }] }));

    await expect(client.payments.get(config(), 's-pay-missing')).rejects.toBeInstanceOf(PspError);
  });
});

/** A basket as the assembler hands it to the client: the required trio plus the serialized lines. */
const UNZER_BASKET = {
  totalValueGross: '112.99',
  currencyCode: 'EUR',
  orderId: 'order-42',
  basketItems: [
    {
      basketItemReferenceId: 'line-0',
      title: 'Widget',
      quantity: 2,
      amountPerUnitGross: '50.00',
      amountDiscountPerUnitGross: '0.00',
      vat: 19,
      type: 'goods',
    },
  ],
};

describe('createBasket', () => {
  // The basket is its OWN resource and it is a V2 one: the vendor's V2 basket model is the shape that
  // carries `totalValueGross` (the V1 model at `/v1/baskets` takes the older `amountTotalGross`).
  it('POSTs the basket to /v2/baskets and returns the created basket id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 's-bsk-55' }));

    const basketId = await client.baskets.create(config(), UNZER_BASKET);

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v2/baskets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(UNZER_BASKET);
    expect(basketId).toBe('s-bsk-55');
  });

  it('raises a typed PspError when a 2xx body carries no basket id (never an undefined basketId link)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}));

    await expect(client.baskets.create(config(), UNZER_BASKET)).rejects.toBeInstanceOf(PspError);
  });

  it('surfaces a non-2xx as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: [{ code: 'API.600.410.024' }] }));

    await expect(client.baskets.create(config(), UNZER_BASKET)).rejects.toBeInstanceOf(PspError);
  });
});

describe('createMetadata', () => {
  it('POSTs the metadata to /v1/metadata and returns the created metadata id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 's-mtd-33' }));

    const metadataId = await client.baskets.createMetadata(config(), {
      shopType: 'commercetools',
      shopVersion: '1.2.3',
      pluginType: 'logeecom-dev/commercetools-unzer',
      pluginVersion: '4.9.0',
    });

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/metadata');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      shopType: 'commercetools',
      shopVersion: '1.2.3',
      pluginType: 'logeecom-dev/commercetools-unzer',
      pluginVersion: '4.9.0',
    });
    expect(metadataId).toBe('s-mtd-33');
  });

  it('raises a typed PspError when a 2xx body carries no metadata id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}));

    await expect(client.baskets.createMetadata(config(), { shopType: 'commercetools' })).rejects.toBeInstanceOf(
      PspError,
    );
  });
});

/** A customer as the resolver builds it from the cart (the vendor requires first and last name). */
const UNZER_CUSTOMER = {
  firstname: 'Peter',
  lastname: 'Universum',
  salutation: 'mr',
  email: 'peter@example.com',
  billingAddress: { name: 'Peter Universum', street: 'Hauptstr 1', zip: '69115', city: 'Heidelberg', country: 'DE' },
  shippingAddress: {
    name: 'Peter Universum',
    street: 'Hauptstr 1',
    zip: '69115',
    city: 'Heidelberg',
    country: 'DE',
    shippingType: 'equals-billing' as const,
  },
};

describe('fetchCustomer', () => {
  it('GETs /v1/customers/{id} (URL-encoded) and returns the customer', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 's-cst-77', ...UNZER_CUSTOMER }));

    const customer = await client.customers.fetch(config(), 's-cst-77');

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/customers/s-cst-77');
    expect(init.method).toBe('GET');
    expect(customer?.id).toBe('s-cst-77');
  });

  // A customer the account no longer holds is not an error - it is the signal to create one, exactly
  // as the reference integration reads `API.410.100.100`. Every OTHER failure still throws.
  it.each(['API.410.100.100', 'API.500.100.100'])('answers null for %s (the create signal)', async (code) => {
    fetchMock.mockResolvedValue(jsonResponse(404, { errors: [{ code }] }));

    await expect(client.customers.fetch(config(), 's-cst-gone')).resolves.toBeNull();
  });

  it('rethrows any other vendor failure as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { errors: [{ code: 'API.010.310.003' }] }));

    await expect(client.customers.fetch(config(), 's-cst-77')).rejects.toBeInstanceOf(PspError);
  });
});

describe('createCustomer', () => {
  it('POSTs the customer to /v1/customers and returns the created customer id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 's-cst-77' }));

    const customerId = await client.customers.create(config(), UNZER_CUSTOMER);

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/customers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(UNZER_CUSTOMER);
    expect(customerId).toBe('s-cst-77');
  });

  it('raises a typed PspError when a 2xx body carries no customer id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}));

    await expect(client.customers.create(config(), UNZER_CUSTOMER)).rejects.toBeInstanceOf(PspError);
  });
});

describe('updateCustomer', () => {
  it('PUTs the customer to /v1/customers/{id} and resolves void', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 's-cst-77' }));

    await expect(client.customers.update(config(), 's-cst-77', UNZER_CUSTOMER)).resolves.toBeUndefined();

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/customers/s-cst-77');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(UNZER_CUSTOMER);
  });

  it('surfaces a non-2xx as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: [{ code: 'API.410.200.010' }] }));

    await expect(client.customers.update(config(), 's-cst-77', UNZER_CUSTOMER)).rejects.toBeInstanceOf(PspError);
  });
});

/** The core's name for one modification - sent as the Unzer idempotency key. */
const OPERATION_REFERENCE = 'op-3f2a9c1b7d40-1';

/** A minimal Unzer modification resource (charge / cancellation share this shape). */
const UNZER_MODIFICATION_BODY = { id: 's-chg-1', isSuccess: true, isPending: false, isError: false, amount: '10.00' };

describe('capture', () => {
  it('POSTs a partial capture to /v1/payments/{id}/charges with the amount as a decimal string', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_MODIFICATION_BODY));

    const modification = await client.payments.capture(config(), {
      paymentId: 's-pay-9f8e7d',
      amountCents: 1000,
      operationReference: OPERATION_REFERENCE,
      fractionDigits: 2,
    });

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d/charges');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ amount: '10.00' });
    // The operation reference is the vendor idempotency key: a retry is the SAME charge to Unzer.
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(OPERATION_REFERENCE);
    expect(modification.id).toBe('s-chg-1');
  });

  it('captures the full authorization (no amount body) when amountCents is omitted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_MODIFICATION_BODY));

    await client.payments.capture(config(), {
      paymentId: 's-pay-9f8e7d',
      operationReference: OPERATION_REFERENCE,
      fractionDigits: 2,
    });

    expect(JSON.parse(fetchCall().init.body as string)).toEqual({});
  });

  it('surfaces a non-2xx as a PspError carrying the transport status; no raw body escapes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { id: 's-err-3', errors: [{ code: 'API.330.100.007', merchantMessage: 'cannot capture' }] }),
    );

    try {
      await client.payments.capture(config(), {
        paymentId: 's-pay-9f8e7d',
        operationReference: OPERATION_REFERENCE,
        fractionDigits: 2,
      });
      throw new Error('expected capture to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PspError);
      expect((e as PspError).statusCode).toBe(400);
      expect((e as PspError).message).toContain('cannot capture');
    }
  });
});

describe('cancelAuthorization', () => {
  it('POSTs to /v1/payments/{id}/authorize/cancels with the idempotency key and voids in full', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ...UNZER_MODIFICATION_BODY, id: 's-cnl-1' }));

    const modification = await client.payments.cancelAuthorization(config(), {
      paymentId: 's-pay-9f8e7d',
      operationReference: OPERATION_REFERENCE,
      fractionDigits: 2,
    });

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d/authorize/cancels');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(OPERATION_REFERENCE);
    expect(modification.id).toBe('s-cnl-1');
  });

  it('surfaces a non-2xx as a PspError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { errors: [{ code: 'API.340.100.007' }] }));

    await expect(
      client.payments.cancelAuthorization(config(), {
        paymentId: 's-pay-9f8e7d',
        operationReference: OPERATION_REFERENCE,
        fractionDigits: 2,
      }),
    ).rejects.toBeInstanceOf(PspError);
  });
});

describe('refund', () => {
  it('POSTs a partial refund to the payment-level charge-cancel endpoint when no chargeId is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ...UNZER_MODIFICATION_BODY, id: 's-cnl-2' }));

    const modification = await client.payments.refund(config(), {
      paymentId: 's-pay-9f8e7d',
      amountCents: 500,
      operationReference: OPERATION_REFERENCE,
      fractionDigits: 2,
    });

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d/charges/cancels');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ amount: '5.00' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(OPERATION_REFERENCE);
    expect(modification.id).toBe('s-cnl-2');
  });

  it('targets a specific charge cancel endpoint when a chargeId is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, UNZER_MODIFICATION_BODY));

    await client.payments.refund(config(), {
      paymentId: 's-pay-9f8e7d',
      chargeId: 's-chg-1',
      operationReference: OPERATION_REFERENCE,
      fractionDigits: 2,
    });

    const { url, init } = fetchCall();
    expect(url).toBe('https://sbx-api.unzer.com/v1/payments/s-pay-9f8e7d/charges/s-chg-1/cancels');
    // A full refund carries no amount body.
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('surfaces a non-2xx refund refusal as a PspError, never a raw body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { id: 's-err-4', errors: [{ code: 'API.340.100.007', merchantMessage: 'refund refused' }] }),
    );

    try {
      await client.payments.refund(config(), {
        paymentId: 's-pay-9f8e7d',
        operationReference: OPERATION_REFERENCE,
        fractionDigits: 2,
      });
      throw new Error('expected refund to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PspError);
      expect((e as PspError).statusCode).toBe(400);
      expect((e as PspError).message).toContain('refund refused');
    }
  });
});
