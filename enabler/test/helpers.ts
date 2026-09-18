import { jest } from '@jest/globals';
import { BaseOptions } from '../src/payment-enabler/payment-enabler-psp';
import { PaymentConfig } from '../src/payment-enabler/payment-config';
import { resolveShopperTexts } from '../src/locale';

/**
 * Minimal `Response` stand-in: the enabler only ever reads `ok`, `status` and calls `json()`.
 * Building the full WHATWG Response is unnecessary and would obscure what each test arranges.
 */
export type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** A 2xx response whose body resolves to `body`. */
export const okJson = (body: unknown, status = 200): FakeResponse => ({
  ok: true,
  status,
  json: () => Promise.resolve(body),
});

/** A non-2xx response (default 500). `json()` resolves to an empty object like the processor error. */
export const errorResponse = (status = 500): FakeResponse => ({
  ok: false,
  status,
  json: () => Promise.resolve({}),
});

export type FetchMock = jest.Mock<(input: unknown, init?: unknown) => Promise<FakeResponse>>;

/**
 * Install a controllable `global.fetch` and return the mock so a test can queue responses
 * (`mockResolvedValueOnce`) and assert on the recorded calls (URL + `init`).
 */
export const installFetchMock = (): FetchMock => {
  const fetchMock = jest.fn() as unknown as FetchMock;
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

/** The url + parsed init + parsed JSON body of a recorded fetch call. */
export type RecordedCall = {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
};

/** Decode one recorded `fetch` call into an assertion-friendly shape. */
export const readCall = (fetchMock: FetchMock, index = 0): RecordedCall => {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`No fetch call recorded at index ${index}`);
  }
  const [url, init] = call as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method,
    headers: (init?.headers as Record<string, string>) ?? {},
    body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
  };
};

export type LocationMock = { assign: jest.Mock; readonly href: string };

/**
 * Observe `window.location.assign(url)` navigations.
 *
 * jsdom locks the whole location surface: `window.location` is a non-configurable accessor and its
 * `assign` is a non-writable, non-configurable own property — it can neither be replaced, spied, nor
 * redefined, and calling it is a silent no-op (it only logs "navigation not implemented"). The public
 * `Location.assign` delegates to the jsdom implementation object hung off the internal `Symbol(impl)`,
 * so we stub `impl.assign` (shadowing its prototype method) to capture the target URL without a real
 * navigation. `restore()` removes the shadow. `href` is read live from the (unchanged) location.
 */
export const installLocationMock = (): { location: LocationMock; restore: () => void } => {
  const implSymbol = Object.getOwnPropertySymbols(window.location).find((s) => s.toString() === 'Symbol(impl)');
  if (!implSymbol) {
    throw new Error('Could not find the jsdom Location impl symbol to stub navigation.');
  }
  const impl = (window.location as unknown as Record<symbol, { assign: unknown }>)[implSymbol];
  const hadOwn = Object.prototype.hasOwnProperty.call(impl, 'assign');
  const original = impl.assign;
  const assign = jest.fn();
  impl.assign = assign;
  const location: LocationMock = {
    assign,
    get href() {
      return window.location.href;
    },
  };
  return {
    location,
    restore: () => {
      if (hadOwn) {
        impl.assign = original;
      } else {
        delete (impl as Record<string, unknown>).assign;
      }
    },
  };
};

/** Let queued microtasks (async fetch/json chains, event-handler `submit`) settle. */
export const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Build the `BaseOptions` a component builder receives, with jest-mock callbacks so a
 * test can assert `onComplete` / `onError` / `onActionRequired` propagation. Returns the options plus
 * direct handles to the mocks.
 */
export const makeBaseOptions = (over: Partial<BaseOptions> = {}) => {
  const onComplete = jest.fn<BaseOptions['onComplete']>();
  const onError = jest.fn<BaseOptions['onError']>();
  const onActionRequired = jest.fn<NonNullable<BaseOptions['onActionRequired']>>();
  // A minimal payment config so a component constructs without a bespoke config; a test overrides
  // `config` when it needs a public key, locale or an enabled method.
  const config: PaymentConfig = {
    publicKey: '',
    environment: 'sandbox',
    locale: 'en-GB',
    currency: 'EUR',
    fractionDigits: 2,
    amount: 0,
    customerType: 'B2C',
    paymentMethods: [],
  };
  // The texts follow whichever config is in force, so a test that overrides `config.locale` gets the
  // matching dictionary without also having to override `texts` — the two are one decision, and the
  // production wiring (`_Setup`) derives one from the other for the same reason.
  const effectiveConfig = (over.config ?? config) as PaymentConfig;
  const baseOptions: BaseOptions = {
    processorUrl: 'https://proc.example',
    sessionId: 'sess-123',
    onComplete,
    onError,
    onActionRequired,
    config,
    texts: resolveShopperTexts(effectiveConfig.locale),
    ...over,
  };
  return { baseOptions, onComplete, onError, onActionRequired };
};
