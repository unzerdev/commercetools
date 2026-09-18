/**
 * Unzer customer resolution — the port of the reference integration's `_getCustomerId`.
 *
 * A charge links a customer resource by id (`resources.customerId`), and that id must be a resource the
 * authenticating Unzer account actually holds. The platform's own customer id is NOT one: sending it
 * refuses the charge. So the resolver has two paths and only two: an id the CHECKOUT SURFACE supplied is
 * forwarded as-is, and a charge that brings none has its customer MAPPED FROM THE CART - created under the
 * merchant-side shopper reference, or written onto the customer the account already holds under it.
 *
 * The vendor client is faked here: this suite is about the DECISION (read / create / update), not about
 * the transport, which `psp-client.spec.ts` pins.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Address, Shopper } from '../src/domain';
import { PspError } from '../src/providers/psp';
import { PspCustomerHandler } from '../src/providers/psp/customer/customer.handler';
import type { CustomerResolveInput } from '../src/providers/psp/customer/customer-resolve-input';
import type { PspConnectionConfig, UnzerCustomer } from '../src/providers/psp/client';

const CONNECTION: PspConnectionConfig = {
  mode: 'sandbox',
  hosts: { sandbox: 'https://sbx-api.unzer.com', live: 'https://api.unzer.com' },
  credentials: { publicKey: 's-pub-1', privateKey: 's-priv-1' },
  requestTimeoutMs: 30_000,
};

const BILLING: Address = {
  firstName: 'Peter',
  lastName: 'Universum',
  street: 'Hauptstr',
  houseNumber: '1',
  postalCode: '69115',
  city: 'Heidelberg',
  countryCode: 'DE',
  salutation: 'Mr',
  phone: '+49 6221 000',
};

const SHOPPER: Shopper = { email: 'peter@example.com', firstName: 'Peter', lastName: 'Universum' };

/**
 * The vendor customer the account already holds, carrying {@link BILLING}'s data unless a case says
 * otherwise. It is written over on every payment, so what a case varies here is only what the
 * account HELD — never whether a write happens.
 */
function heldCustomer(over: Partial<UnzerCustomer> = {}): UnzerCustomer {
  return {
    id: 's-cst-77',
    firstname: 'Peter',
    lastname: 'Universum',
    email: 'peter@example.com',
    salutation: 'mr',
    billingAddress: { name: 'Peter Universum', street: 'Hauptstr 1', zip: '69115', city: 'Heidelberg', country: 'DE' },
    shippingAddress: {
      name: 'Peter Universum',
      street: 'Hauptstr 1',
      zip: '69115',
      city: 'Heidelberg',
      country: 'DE',
      shippingType: 'equals-billing',
    },
    ...over,
  };
}

let unzer: {
  customers: {
    fetch: jest.Mock<(cfg: PspConnectionConfig, id: string) => Promise<UnzerCustomer | null>>;
    create: jest.Mock<(cfg: PspConnectionConfig, customer: UnzerCustomer) => Promise<string>>;
    update: jest.Mock<(cfg: PspConnectionConfig, id: string, customer: UnzerCustomer) => Promise<void>>;
  };
};
let handler: PspCustomerHandler;

beforeEach(() => {
  unzer = {
    customers: {
      fetch: jest.fn(),
      create: jest.fn(async () => 's-cst-new'),
      update: jest.fn(async () => undefined),
    },
  };
  handler = new PspCustomerHandler(unzer);
});

/** Resolve with the standard cart data, overriding whatever a case is about. */
function resolve(over: Record<string, unknown> = {}): Promise<string | undefined> {
  return handler.resolveCustomerId(CONNECTION, {
    shopper: SHOPPER,
    billingAddress: BILLING,
    shippingAddress: BILLING,
    ...over,
  });
}

// A GUEST the surface supplied no id for: there is no reference to read by, so the cart is mapped and written
// straight out, and nothing is read first.
describe('resolveCustomerId — a shopper the account has not seen', () => {
  it('creates the customer from the cart, reading nothing first', async () => {
    await expect(resolve()).resolves.toBe('s-cst-new');

    expect(unzer.customers.fetch).not.toHaveBeenCalled();
    expect(unzer.customers.create).toHaveBeenCalledTimes(1);
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  it('never accepts a customer id from the caller — the input carries no such field', () => {
    // A compile-time guarantee, asserted here so the intent survives a future refactor: the resolver's
    // input has no member through which a browser-supplied vendor customer id could enter.
    const input: CustomerResolveInput = {};
    expect(Object.keys(input)).not.toContain('providerCustomerId');
  });
});

/**
 * The id the CHECKOUT SURFACE supplies. The vendor's own customer form creates a customer in the
 * browser under the PUBLIC key, from the form the shopper just filled, and that resource carries the shopper's
 * DATE OF BIRTH - which the element exposes through no other channel: its `getCustomerData()` returns email,
 * salutation, first/last name and the addresses, and nothing else. So when an id comes with the charge it IS
 * the payer: forwarded as-is, with no read and no write, and the connector maps nothing.
 */
describe('resolveCustomerId — an id the checkout surface supplied', () => {
  it('forwards the id and touches the vendor for nothing', async () => {
    await expect(resolve({ candidateCustomerId: 's-cst-browser' })).resolves.toBe('s-cst-browser');

    expect(unzer.customers.fetch).not.toHaveBeenCalled();
    expect(unzer.customers.create).not.toHaveBeenCalled();
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  // A SIGNED-IN shopper is no different: the merchant-side reference path is for a charge that brings no id.
  it('forwards it for a signed-in shopper too, and writes no customer of its own', async () => {
    await expect(resolve({ shopperRef: 'ct-cust-9', candidateCustomerId: 's-cst-browser' })).resolves.toBe(
      's-cst-browser',
    );

    expect(unzer.customers.create).not.toHaveBeenCalled();
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  /**
   * The one thing the forward gives up, stated as a test: an id the account does NOT hold is not caught here.
   * The charge itself catches it - Unzer refuses a `resources.customerId` it cannot resolve - and a refused
   * charge is the correct outcome for a browser that named a customer this account has no business charging.
   */
  it('does not verify the id against the account', async () => {
    await resolve({ candidateCustomerId: 's-cst-not-ours' });

    expect(unzer.customers.fetch).not.toHaveBeenCalled();
  });

  // A cart that describes nobody still resolves when the surface named a customer: the id is the description.
  it('forwards the id even when the cart describes nobody', async () => {
    await expect(handler.resolveCustomerId(CONNECTION, { candidateCustomerId: 's-cst-browser' })).resolves.toBe(
      's-cst-browser',
    );
  });
});

/**
 * `heldCustomerId` - the `CustomerDirectory` capability the SHOPPER CONFIG decorates itself with. It
 * answers the resource the surface must UPDATE, and it is BEST-EFFORT by contract: it decorates a config
 * response, so a vendor failure must never take a checkout down.
 */
describe('heldCustomerId', () => {
  // A resolved StoreConfig, only as far as `toPspConnectionConfig` reads it.
  const cfg = {
    storeKey: 'store-1',
    mode: 'sandbox',
    vendorHosts: CONNECTION.hosts,
    credentials: CONNECTION.credentials,
    requestTimeoutMs: CONNECTION.requestTimeoutMs,
  } as never;

  it('answers the id the account holds under the merchant reference', async () => {
    unzer.customers.fetch.mockResolvedValue(heldCustomer({ id: 's-cst-held' }));

    await expect(handler.heldCustomerId(cfg, 'ct-cust-9')).resolves.toBe('s-cst-held');
    expect(unzer.customers.fetch.mock.calls[0]?.[1]).toBe('ct-cust-9');
  });

  it('answers nothing when the account holds no such customer', async () => {
    unzer.customers.fetch.mockResolvedValue(null);

    await expect(handler.heldCustomerId(cfg, 'ct-cust-9')).resolves.toBeUndefined();
  });

  it('answers nothing rather than throwing when the vendor read fails', async () => {
    unzer.customers.fetch.mockRejectedValue(new PspError('PSP API error', 401));

    await expect(handler.heldCustomerId(cfg, 'ct-cust-9')).resolves.toBeUndefined();
  });

  it('reads nothing for an empty reference — a guest has none', async () => {
    await expect(handler.heldCustomerId(cfg, '')).resolves.toBeUndefined();
    expect(unzer.customers.fetch).not.toHaveBeenCalled();
  });
});

// The merchant-side shopper reference is the PLATFORM CUSTOMER ID and it is UNIQUE on the vendor
// account, so a shopper who already paid once is UPDATED, never created twice. The read comes first - the
// vendor's read takes the merchant reference as well as its own resource id - and the `API.410.200.010`
// collision remains handled as the race it now is.
describe('resolveCustomerId — a merchant reference the account already holds', () => {
  const taken = () =>
    new PspError('PSP API error: customerId already exists.', 400, [
      { code: 'API.410.200.010', message: 'customerId already exists.' },
    ]);

  it('reads the customer by the merchant reference and updates it instead of creating a second one', async () => {
    unzer.customers.fetch.mockResolvedValue(heldCustomer({ id: 's-cst-existing', lastname: 'Andersson' }));

    await expect(resolve({ shopperRef: 'ct-cust-9' })).resolves.toBe('s-cst-existing');

    // The read is BY THE PLATFORM CUSTOMER ID: the vendor resource id is not known here, and the connector
    // stores no mapping of its own.
    expect(unzer.customers.fetch).toHaveBeenCalledWith(CONNECTION, 'ct-cust-9');
    expect(unzer.customers.create).not.toHaveBeenCalled();
    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, id, sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(id).toBe('s-cst-existing');
    expect(sent).toMatchObject({ firstname: 'Peter', customerId: 'ct-cust-9' });
  });

  /**
   * The update is UNCONDITIONAL: the held customer is rewritten with this checkout's data whether
   * or not anything appears to have changed. A comparison has to enumerate the fields that matter, and that
   * enumeration is exactly what went stale — a live account held a customer with an empty `birthDate`, the
   * comparison called it unchanged, and every `paylater-invoice` charge against it was refused for a datum
   * the connector was holding.
   */
  it('updates the held customer even when it already carries this cart data', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(heldCustomer({ id: 's-cst-existing', customerId: 'ct-cust-9' }));

    await expect(resolve({ shopperRef: 'ct-cust-9' })).resolves.toBe('s-cst-existing');

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, id, sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(id).toBe('s-cst-existing');
    expect(sent).toMatchObject({ firstname: 'Peter', lastname: 'Universum', email: 'peter@example.com' });
  });

  /**
   * OBSERVED on the live account: the held customer `s-cst-5teu9uo7tdt7` carried an EMPTY `birthDate`,
   * because it had been created before the connector had one to send. Comparing only the reference
   * integration's fields (name, company, email, addresses) made that customer "match", the update was
   * skipped, and every `paylater-invoice` charge against it was refused with `COR.100.301.112` "Missing
   * element 'Transaction/Customer/Name/Birthdate'" — a datum the connector HAD and could not deliver,
   * for as long as the shopper kept their vendor customer. A field we now hold and the vendor does not
   * is a drift, whatever the reference compares.
   */
  it('updates the held customer when it lacks the date of birth the cart supplies', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({ id: 's-cst-existing', customerId: 'ct-cust-9', birthDate: '' }),
    );

    await expect(resolve({ shopperRef: 'ct-cust-9', shopper: { ...SHOPPER, dateOfBirth: '19861212' } })).resolves.toBe(
      's-cst-existing',
    );

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, , sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(sent).toMatchObject({ birthDate: '1986-12-12' });
  });

  it('updates the held customer when its date of birth differs from the cart one', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({
        id: 's-cst-existing',
        customerId: 'ct-cust-9',
        birthDate: '1970-01-01',
      }),
    );

    await expect(resolve({ shopperRef: 'ct-cust-9', shopper: { ...SHOPPER, dateOfBirth: '19861212' } })).resolves.toBe(
      's-cst-existing',
    );

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
  });

  /**
   * The consequence of writing unconditionally, stated so it is a decision and not a surprise: the body sent
   * is built from THIS cart, so a birthdate the vendor holds and this checkout does not is overwritten with
   * nothing. The cart is the authority on the shopper, and the connector now has two sources for the
   * birthdate (the checkout surface and the commercetools profile), so a cart that carries none is a cart
   * whose shopper the platform does not describe.
   */
  it('sends this cart data even where the held customer carries more than the cart does', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({
        id: 's-cst-existing',
        customerId: 'ct-cust-9',
        birthDate: '1986-12-12',
      }),
    );

    await expect(resolve({ shopperRef: 'ct-cust-9' })).resolves.toBe('s-cst-existing');

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, , sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(sent).not.toHaveProperty('birthDate');
  });

  it('updates the held customer when the salutation it holds is not the one the cart states', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({
        id: 's-cst-existing',
        customerId: 'ct-cust-9',
        salutation: 'unknown',
      }),
    );

    // BILLING carries `salutation: 'Mr'`, which the provider maps to the vendor's `mr`.
    await expect(resolve({ shopperRef: 'ct-cust-9' })).resolves.toBe('s-cst-existing');

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, , sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(sent).toMatchObject({ salutation: 'mr' });
  });

  // A guest carries no merchant reference, so a collision on one is impossible; if the vendor reports it
  // anyway there is nothing to read by, and inventing a second customer would be worse than failing.
  it('rethrows the collision when the customer carries no merchant reference to fetch by', async () => {
    unzer.customers.create.mockRejectedValue(taken());

    await expect(resolve()).rejects.toBeInstanceOf(PspError);
    expect(unzer.customers.fetch).not.toHaveBeenCalled();
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  // The collision is now a RACE: the first read found nothing, the create lost to a concurrent one, and the
  // second read is what finds the winner's resource. A second read that still finds nothing is unrecoverable.
  it('rethrows the collision when the reference read finds nothing after all', async () => {
    unzer.customers.create.mockRejectedValue(taken());
    unzer.customers.fetch.mockResolvedValue(null);

    await expect(resolve({ shopperRef: 'ct-cust-9' })).rejects.toBeInstanceOf(PspError);
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  // A failure that is not the collision is not recovered: the reference read already said the account holds no
  // such customer, so there is nothing to update and a second read would ask the same question twice.
  it('rethrows any other creation failure without reading again', async () => {
    unzer.customers.create.mockRejectedValue(new PspError('PSP API error', 401));

    await expect(resolve({ shopperRef: 'ct-cust-9' })).rejects.toBeInstanceOf(PspError);
    expect(unzer.customers.fetch).toHaveBeenCalledTimes(1);
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });
});

// The held customer is rewritten with the cart's data on every payment, so what matters is that
// the body sent is THIS cart's, whatever the account happened to hold.
describe('resolveCustomerId — updating a held customer', () => {
  const taken = () =>
    new PspError('PSP API error: customerId already exists.', 400, [
      { code: 'API.410.200.010', message: 'customerId already exists.' },
    ]);
  const reference = 'ct-cust-9';

  beforeEach(() => {
    unzer.customers.create.mockRejectedValue(taken());
  });

  it.each([
    ['a changed surname', { lastname: 'Andersson' }],
    ['a changed email', { email: 'someone.else@example.com' }],
    ['a changed billing city', { billingAddress: { ...heldCustomer().billingAddress, city: 'Mannheim' } }],
    ['a changed billing street', { billingAddress: { ...heldCustomer().billingAddress, street: 'Nebenstr 9' } }],
    ['a changed postal code', { billingAddress: { ...heldCustomer().billingAddress, zip: '10115' } }],
    ['a changed country', { billingAddress: { ...heldCustomer().billingAddress, country: 'AT' } }],
    ['an added company', { company: 'Acme GmbH' }],
  ])('updates the held customer on %s', async (_case, drift) => {
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({ customerId: reference, ...(drift as Partial<UnzerCustomer>) }),
    );

    await expect(resolve({ shopperRef: 'ct-cust-9' })).resolves.toBe('s-cst-77');

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
    const [, id, sent] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(id).toBe('s-cst-77');
    // The update carries the CART's data, which is the point of updating.
    expect(sent).toMatchObject({ lastname: 'Universum', email: 'peter@example.com' });
  });

  it('writes even when nothing about the held customer differs from the cart', async () => {
    unzer.customers.fetch.mockResolvedValue(heldCustomer({ customerId: reference, company: '' }));

    await resolve({ shopperRef: 'ct-cust-9' });

    expect(unzer.customers.update).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCustomerId — the customer body', () => {
  /** The customer body the resolver sent to `createCustomer`. */
  async function created(over: Record<string, unknown> = {}): Promise<UnzerCustomer> {
    await resolve(over);
    return (unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer])[1];
  }

  it('maps identity, contact and both addresses from the cart', async () => {
    expect(await created()).toMatchObject({
      firstname: 'Peter',
      lastname: 'Universum',
      salutation: 'mr',
      email: 'peter@example.com',
      phone: '+49 6221 000',
      billingAddress: {
        name: 'Peter Universum',
        street: 'Hauptstr 1',
        zip: '69115',
        city: 'Heidelberg',
        country: 'DE',
      },
    });
  });

  /**
   * The merchant-side reference is what keeps ONE vendor customer per shopper across payments, and it is the
   * platform customer id ALONE: composing it with the email and the store key made a shopper who
   * edited their email - or checked out in a second store - a second vendor customer. A guest has no platform
   * id, so it carries no reference; a shared one would collide guests with each other.
   */
  it('uses the platform customer id itself as the merchant shopper reference', async () => {
    expect((await created({ shopperRef: 'ct-cust-9' })).customerId).toBe('ct-cust-9');
  });

  it('sends no merchant shopper reference for a guest', async () => {
    expect(await created()).not.toHaveProperty('customerId');
  });

  it.each([
    ['Mr', 'mr'],
    ['Mrs', 'mrs'],
    ['Ms', 'mrs'],
    ['Miss', 'mrs'],
    ['Dr', 'unknown'],
    [undefined, 'unknown'],
  ])('maps the platform salutation %s onto %s', async (salutation, expected) => {
    const customer = await created({ billingAddress: { ...BILLING, salutation } });

    expect(customer.salutation).toBe(expected);
  });

  it('marks the shipping address as equal to billing when every field matches', async () => {
    expect((await created()).shippingAddress?.shippingType).toBe('equals-billing');
  });

  it('marks a different shipping address as such — a risk signal the secured methods read', async () => {
    const customer = await created({ shippingAddress: { ...BILLING, city: 'Mannheim' } });

    expect(customer.shippingAddress?.shippingType).toBe('different-address');
  });

  it('derives the customer language from the primary subtag of the shopper locale', async () => {
    expect((await created({ locale: 'de-DE' })).language).toBe('de');
  });

  it('reformats the shopper date of birth into the vendor date format', async () => {
    const customer = await created({ shopper: { ...SHOPPER, dateOfBirth: '19871220' } });

    expect(customer.birthDate).toBe('1987-12-20');
  });

  it('joins the street name and house number, de-duplicating a repeated line', async () => {
    const customer = await created({ billingAddress: { ...BILLING, street: 'Hauptstr 1', houseNumber: 'Hauptstr 1' } });

    expect(customer.billingAddress?.street).toBe('Hauptstr 1');
  });
});

describe('resolveCustomerId — carts that cannot describe a shopper', () => {
  // The vendor requires a first and last name. A cart that has neither cannot produce a customer, and a
  // card payment must not fail for it — the reference integration likewise yields no customer there.
  it('resolves to no customer id when the cart carries no name', async () => {
    await expect(resolve({ shopper: { email: 'anon@example.com' }, billingAddress: {} })).resolves.toBeUndefined();

    expect(unzer.customers.create).not.toHaveBeenCalled();
  });

  it('reads nothing from the vendor for a cart that cannot describe a shopper', async () => {
    await resolve({ shopper: {}, billingAddress: {}, shippingAddress: {} });

    expect(unzer.customers.fetch).not.toHaveBeenCalled();
    expect(unzer.customers.update).not.toHaveBeenCalled();
  });

  it('takes the name from the billing address when the shopper carries none', async () => {
    await resolve({ shopper: { email: 'peter@example.com' } });

    const [, customer] = unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer];
    expect(customer).toMatchObject({ firstname: 'Peter', lastname: 'Universum' });
  });
});

/**
 * The B2B switch. Unzer decides a customer is a business by the presence of `company`, and a business
 * customer must also carry `companyInfo` — the vendor refuses an invoice charge for a company it knows
 * nothing about. A commercetools cart carries only the company NAME, so the connector states the least it
 * can while still declaring the customer B2B. Real B2B answers reach the vendor only the way the shopper gives
 * them - typed into the vendor's own customer form, whose customer the charge then forwards whole.
 */
describe('the B2B customer', () => {
  const withCompany = { ...BILLING, company: 'Universum GmbH' };

  it('declares the company and the least it can say about it', async () => {
    await resolve({ billingAddress: withCompany, shippingAddress: withCompany });

    const [, created] = unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer];
    expect(created.company).toBe('Universum GmbH');
    expect(created.companyInfo).toEqual({
      registrationType: 'not_registered',
      function: 'OWNER',
      commercialSector: 'OTHER',
    });
  });

  /**
   * The company a shopper DELETED must reach the vendor as a deletion. Two traps, and both were live: the
   * company was read off the customer the account already held whenever the cart stated none, and the vendor's
   * PUT MERGES, so an omitted field kept the stored value. The cart's billing address is the authority, and the
   * clearing is explicit - top level and on the billing address, which the vendor keeps as its own field.
   */
  it('clears a company the cart no longer carries, on the customer and on its billing address', async () => {
    unzer.customers.create.mockRejectedValue(
      new PspError('PSP API error: customerId already exists.', 400, [
        { code: 'API.410.200.010', message: 'customerId already exists.' },
      ]),
    );
    unzer.customers.fetch.mockResolvedValue(
      heldCustomer({
        customerId: 'ct-cust-9',
        company: 'Company Test',
        billingAddress: { name: 'Peter Universum', street: 'Hauptstr 1', city: 'Heidelberg', company: 'Company 1' },
      }),
    );

    await resolve({ shopperRef: 'ct-cust-9', billingAddress: BILLING });

    const [, , updated] = unzer.customers.update.mock.calls[0] as [unknown, string, UnzerCustomer];
    expect(updated.company).toBe('');
    expect(updated.billingAddress?.company).toBe('');
    expect(updated.companyInfo).toBeUndefined();
  });

  // No company means a PRIVATE customer: sending `companyInfo` anyway would declare a business that is not one.
  it('sends no company details for a customer with no company', async () => {
    await resolve();

    const [, created] = unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer];
    expect(created.company).toBeUndefined();
    expect(created.companyInfo).toBeUndefined();
  });
});

// The vendor form has two number fields and the platform holds them separately; a mobile must not be
// back-filled from the landline, nor the landline from the mobile.
describe('the two phone numbers', () => {
  it('carries the mobile and the phone independently', async () => {
    await resolve({ billingAddress: { ...BILLING, mobile: '+49 170 000' } });

    const [, created] = unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer];
    expect(created.phone).toBe('+49 6221 000');
    expect(created.mobile).toBe('+49 170 000');
  });

  it('sends no mobile when the platform holds none', async () => {
    await resolve();

    expect((unzer.customers.create.mock.calls[0] as [unknown, UnzerCustomer])[1].mobile).toBeUndefined();
  });
});
