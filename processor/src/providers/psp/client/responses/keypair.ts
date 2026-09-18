import { PspError } from '../../errors';

/**
 * The keypair response. `/v1/keypair` answers `availablePaymentTypes`, `/v1/keypair/types` answers
 * `paymentTypes`; the code universe is the union of whichever arrive.
 */
interface UnzerKeypairResponse {
  availablePaymentTypes?: string[];
  paymentTypes?: UnzerKeypairPaymentType[];
  publicKey?: string;
}

/** One entry of the detailed keypair's `paymentTypes[]`; a type may appear in several entries. */
interface UnzerKeypairPaymentType {
  type?: string;
  supports?: Array<{ countries?: string[]; currency?: string[]; channel?: string; brands?: string[] }>;
  /** Which kinds of payer the account may charge this method for, comma-joined (`"B2B,B2C"`). */
  allowCustomerTypes?: string;
}

/** The coverage the account declares for one method type; an empty list means unrestricted on that axis. */
export interface MethodSupport {
  code: string;
  countries: string[];
  currencies: string[];
  customerTypes: string[];
  /** The card brands as the vendor spells them; empty means the vendor states none, never "all". */
  brands: string[];
  /** The vendor channel the method is served through; Google Pay reads it as `gatewayMerchantId`. */
  channel?: string;
}

/** The lifted keypair: the code universe, the per-method coverage, and the account's own public key. */
export interface KeypairResult {
  availableMethods: string[];
  methodSupport: MethodSupport[];
  publicKey?: string;
}

/** Validate and lift the keypair body; a wrong-typed field is drift and fails as a typed 502. */
export function parseKeypairResponse(raw: unknown): KeypairResult {
  const body = expectObject(raw, 'keypair') as UnzerKeypairResponse;
  const types = body.availablePaymentTypes;

  if (types !== undefined && !(Array.isArray(types) && types.every((type) => typeof type === 'string'))) {
    throw PspError.malformedResponse('keypair: availablePaymentTypes is not a list of method type codes');
  }
  if (body.paymentTypes !== undefined && !Array.isArray(body.paymentTypes)) {
    throw PspError.malformedResponse('keypair: paymentTypes is not a list');
  }

  const publicKey = body.publicKey;
  if (publicKey !== undefined && typeof publicKey !== 'string') {
    throw PspError.malformedResponse('keypair: publicKey is not a string');
  }

  return {
    availableMethods: toAvailableMethods(body),
    methodSupport: toMethodSupport(body.paymentTypes),
    ...(publicKey ? { publicKey } : {}),
  };
}

/** The union of the flat list and the distinct types named by `paymentTypes[]`, in first-seen order. */
function toAvailableMethods(body: UnzerKeypairResponse | undefined): string[] {
  const codes = new Set<string>(body?.availablePaymentTypes ?? []);
  for (const entry of body?.paymentTypes ?? []) {
    if (entry.type) {
      codes.add(entry.type);
    }
  }
  return [...codes];
}

/** One type's accumulated coverage: the values seen, plus whether any block left an axis open. */
interface Coverage {
  countries: Set<string>;
  currencies: Set<string>;
  customerTypes: Set<string>;
  brands: Set<string>;
  openCountries: boolean;
  openCurrencies: boolean;
  openCustomerTypes: boolean;
  channel?: string;
}

/**
 * One entry per distinct type whose coverage is the union over every entry and `supports` block; an empty
 * list on an axis means unrestricted and wins over any enumeration. Brands are unioned, never treated as open.
 */
function toMethodSupport(paymentTypes: UnzerKeypairPaymentType[] | undefined): MethodSupport[] {
  const byType = new Map<string, Coverage>();

  for (const entry of paymentTypes ?? []) {
    if (!entry.type) {
      continue;
    }
    let coverage = byType.get(entry.type);
    if (!coverage) {
      coverage = {
        countries: new Set(),
        currencies: new Set(),
        customerTypes: new Set(),
        brands: new Set(),
        openCountries: false,
        openCurrencies: false,
        openCustomerTypes: false,
      };
      byType.set(entry.type, coverage);
    }

    const payerKinds = (entry.allowCustomerTypes ?? '')
      .split(',')
      .map((kind) => kind.trim().toUpperCase())
      .filter((kind) => kind !== '');
    coverage.openCustomerTypes ||= payerKinds.length === 0;
    payerKinds.forEach((kind) => coverage.customerTypes.add(kind));

    const supports = entry.supports ?? [];
    if (supports.length === 0) {
      coverage.openCountries = true;
      coverage.openCurrencies = true;
      continue;
    }
    for (const block of supports) {
      const countries = block.countries ?? [];
      const currencies = block.currency ?? [];
      coverage.openCountries ||= countries.length === 0;
      coverage.openCurrencies ||= currencies.length === 0;
      countries.forEach((country) => coverage.countries.add(country));
      currencies.forEach((currency) => coverage.currencies.add(currency));
      (block.brands ?? []).forEach((brand) => coverage.brands.add(brand));
      coverage.channel ??= block.channel;
    }
  }

  return [...byType.entries()].map(([code, coverage]) => ({
    code,
    countries: coverage.openCountries ? [] : [...coverage.countries],
    currencies: coverage.openCurrencies ? [] : [...coverage.currencies],
    customerTypes: coverage.openCustomerTypes ? [] : [...coverage.customerTypes],
    brands: [...coverage.brands],
    ...(coverage.channel ? { channel: coverage.channel } : {}),
  }));
}

/** A JSON object body, or a typed 502. An absent body counts as empty, not as drift. */
export function expectObject(raw: unknown, what: string): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw PspError.malformedResponse(`${what}: the vendor answered a non-object body`);
  }
  return raw as Record<string, unknown>;
}
