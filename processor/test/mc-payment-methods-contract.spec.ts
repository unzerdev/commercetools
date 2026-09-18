/**
 * Contract guard across the MC ⇄ processor seam for the PAYMENT-METHODS document (two
 * hand-mirrored, mutually-mocked sides of a boundary hide a shape drift). The merchant app cannot import
 * processor code - a shared import would drag server-only dependencies into the MC bundle - so
 * `mc/src/types/config.ts` re-declares the document by hand as `UnzerMethodConfigDto`.
 *
 * This guard does not re-mirror that list a THIRD time: it READS the MC type declaration and compares the
 * member names it finds against the real TypeBox schemas. A rename or a new field on either side therefore
 * fails HERE, in the processor suite, rather than at a merchant's save (a member the processor requires and
 * the MC never sends) or a silently-ignored setting (a member the MC sends and the strict PUT rejects).
 *
 * Three sets are pinned, and their relationship is the contract: every MC member exists in the GET VIEW
 * schema; the members the MC declares read-only are exactly the view's derived surplus over the PUT REQUEST
 * schema; and a document built in the MC's own shape passes the real validator.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Value } from '@sinclair/typebox/value';
import {
  PaymentMethodsRequestSchema,
  PaymentMethodsViewResponseSchema,
} from '../src/infrastructure/http/dtos/mc/payment-methods.dto';

const MC_CONFIG_TYPES = join(__dirname, '..', '..', 'mc', 'src', 'types', 'config.ts');

/** One member of a parsed MC type: its name and whether the declaration marks it optional (`name?:`). */
interface DeclaredMember {
  name: string;
  optional: boolean;
}

/**
 * Extract the members of one `export type <name> = { … };` declaration from the MC source. Only lines at
 * the declaration's own indentation that read `member:` or `member?:` count, so the doc comments between
 * members and any nested object literal are skipped. Throws when the declaration is absent or empty, which
 * is what stops a rename in the MC from turning this guard into a comparison of two empty sets.
 */
const declaredMembers = (source: string, typeName: string): DeclaredMember[] => {
  const opening = `export type ${typeName} = {`;
  const start = source.indexOf(opening);
  if (start < 0) {
    throw new Error(`${typeName} is no longer declared in mc/src/types/config.ts`);
  }
  const body = source.slice(start + opening.length);
  const end = body.indexOf('\n};');
  if (end < 0) {
    throw new Error(`${typeName} in mc/src/types/config.ts has no closing brace`);
  }
  const members = [...body.slice(0, end).matchAll(/^ {2}(\w+)(\?)?:/gm)].map((match) => ({
    name: match[1] as string,
    optional: match[2] === '?',
  }));
  if (members.length === 0) {
    throw new Error(`${typeName} in mc/src/types/config.ts declares no members`);
  }
  return members;
};

const source = readFileSync(MC_CONFIG_TYPES, 'utf8');
const names = (members: DeclaredMember[]) => members.map((m) => m.name).sort();
const optionalNames = (members: DeclaredMember[]) =>
  members
    .filter((m) => m.optional)
    .map((m) => m.name)
    .sort();

const methodMembers = declaredMembers(source, 'UnzerMethodConfigDto');

/** TypeBox types `required` as a literal tuple; the comparisons here work over plain strings. */
const requiredOf = (schema: { required: readonly string[] }): string[] => [...schema.required];

const requestItem = PaymentMethodsRequestSchema.properties.paymentMethods.items;
const viewItem = PaymentMethodsViewResponseSchema.properties.paymentMethods.items;

describe('MC UnzerMethodConfigDto ⇄ processor payment-methods schema contract', () => {
  it('declares exactly the members the GET view serializes', () => {
    expect(names(methodMembers)).toEqual(Object.keys(viewItem.properties).sort());
  });

  // `bookingMode` is optional on BOTH sides: only a method that accepts both transaction kinds carries
  // one. The currency-keyed amount maps are optional where an absent currency means "no bound"; every
  // DERIVED member is optional in the MC because the type also describes the PUT ECHO, which is the
  // request shape and carries none of them.
  it('marks bookingMode, the optional amount maps and the derived fields optional; every persisted member required', () => {
    expect(optionalNames(methodMembers)).toEqual(
      [
        'applePay',
        'bookingMode',
        'clickToPayEnabled',
        'googlePay',
        'logo',
        'maxAmount',
        'minAmount',
        'supportsAuthorize',
        'supportsCharge',
        'vendorCardNetworks',
        'vendorChannel',
        'vendorCountries',
        'vendorCurrencies',
        'vendorCustomerTypes',
      ].sort(),
    );
    expect(
      Object.keys(requestItem.properties)
        .filter((key) => !requiredOf(requestItem).includes(key))
        .sort(),
    ).toEqual(['applePay', 'bookingMode', 'clickToPayEnabled', 'googlePay', 'maxAmount', 'minAmount']);
  });

  // The MC strips the derived fields before every PUT. That the strict request schema omits exactly them
  // is what makes the strip sufficient - and necessary, per the rejection test below. `logo` is derived
  // from the method CODE and served by this connector, and the capability flags and the vendor coverage
  // come off the keypair, so none of them is ever persisted.
  it('the members the MC treats as read-only are the view surplus over the PUT request', () => {
    const surplus = Object.keys(viewItem.properties)
      .filter((key) => !(key in requestItem.properties))
      .sort();
    expect(surplus).toEqual([
      'logo',
      'supportsAuthorize',
      'supportsCharge',
      'vendorCardNetworks',
      'vendorChannel',
      'vendorCountries',
      'vendorCurrencies',
      'vendorCustomerTypes',
    ]);
    for (const key of surplus) {
      expect(methodMembers.find((m) => m.name === key)?.optional).toBe(true);
    }
  });
});

describe('a document in the MC shape against the real payment-methods validator', () => {
  /** What `rowsToMethod` + the pre-PUT strip produce: currency-keyed maps, no derived fields. */
  const mcPutBody = () => ({
    paymentMethods: [
      {
        paymentMethodCode: 'card',
        enabled: true,
        name: { en: 'Cards' },
        description: { en: 'Visa, Mastercard, Maestro and more.' },
        bookingMode: 'authorize',
        minAmount: { EUR: 500, JPY: 500 },
        maxAmount: { EUR: 100000 },
        surcharge: { EUR: 150 },
        countries: ['DE', 'NL'],
        sendBasketData: true,
      },
    ],
  });

  it('accepts the body the MC PUTs', () => {
    expect(Value.Check(PaymentMethodsRequestSchema, mcPutBody())).toBe(true);
  });

  it('accepts a method with no amount maps and an empty surcharge - no limits and no surcharge, stated', () => {
    const body = mcPutBody();
    delete (body.paymentMethods[0] as Record<string, unknown>).minAmount;
    delete (body.paymentMethods[0] as Record<string, unknown>).maxAmount;
    (body.paymentMethods[0] as Record<string, unknown>).surcharge = {};
    expect(Value.Check(PaymentMethodsRequestSchema, body)).toBe(true);
  });

  /**
   * The SCHEMA is strict, so a derived field makes the document invalid - asserted so a schema
   * loosening cannot go unnoticed. Note what this does NOT say: the ROUTE does not answer 400 on such a
   * body. Fastify's ajv runs with its `removeAdditional: true` default, so the undeclared property is
   * stripped and the save succeeds without it (pinned in `payment-methods-routes.spec.ts`). That is why
   * the merchant app strips it itself - an unstripped field would be discarded in silence, and the
   * sender would believe it had been saved.
   */
  it('makes a document invalid when it carries supportsAuthorize', () => {
    const body = mcPutBody();
    (body.paymentMethods[0] as Record<string, unknown>).supportsAuthorize = true;
    expect(Value.Check(PaymentMethodsRequestSchema, body)).toBe(false);
  });
});
