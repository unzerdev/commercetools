/**
 * The `CustomerReader` adapter: one commercetools Customer read, for ONE datum — the shopper's date of
 * birth, which buy-now-pay-later methods are refused without (`paylater-invoice` answers
 * `COR.100.301.112` "Missing element 'Transaction/Customer/Name/Birthdate'") and which a CART does not
 * carry.
 *
 * The platform stores it as `YYYY-MM-DD`; the provider's shopper contract carries `YYYYMMDD`, so the
 * adapter converts at this boundary. Nothing about a missing or malformed value may throw: it is an
 * optional profile field, and a payment that fails because a profile field could not be read would refuse
 * a shopper the vendor never objected to.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { log } from '../src/infrastructure/bootstrap/libs/logger';
import { CustomerReaderAdapter } from '../src/infrastructure/adapters/customer-reader.adapter';

interface Captured {
  id?: { ID: string };
  execute: jest.Mock<() => Promise<unknown>>;
}

function mockCustomers(): Captured {
  const captured: Captured = { execute: jest.fn<() => Promise<unknown>>() };
  const builder = {
    withId: (args: { ID: string }) => {
      captured.id = args;
      return { get: () => ({ execute: captured.execute }) };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'customers').mockReturnValue(builder as never);
  return captured;
}

describe('CustomerReaderAdapter.dateOfBirth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the customer by id and converts the platform date to YYYYMMDD', async () => {
    const captured = mockCustomers();
    captured.execute.mockResolvedValue({ body: { id: 'cust-1', dateOfBirth: '1985-04-09' } });

    await expect(new CustomerReaderAdapter().dateOfBirth('cust-1')).resolves.toBe('19850409');
    expect(captured.id).toEqual({ ID: 'cust-1' });
    expect(captured.execute).toHaveBeenCalledTimes(1);
  });

  it('answers undefined for a customer that carries no date of birth', async () => {
    const captured = mockCustomers();
    captured.execute.mockResolvedValue({ body: { id: 'cust-1' } });

    await expect(new CustomerReaderAdapter().dateOfBirth('cust-1')).resolves.toBeUndefined();
  });

  it('answers undefined for a customer commercetools does not know, without throwing', async () => {
    const captured = mockCustomers();
    captured.execute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

    await expect(new CustomerReaderAdapter().dateOfBirth('missing')).resolves.toBeUndefined();
  });

  // A malformed stored value is not a reason to refuse a payment: the vendor is the one that decides
  // whether the birthdate was required, and it names the field when it was.
  it.each(['09.04.1985', '1985-4-9', '', 'not-a-date'])(
    'answers undefined for the unusable value %p',
    async (value) => {
      const captured = mockCustomers();
      captured.execute.mockResolvedValue({ body: { id: 'cust-1', dateOfBirth: value } });

      await expect(new CustomerReaderAdapter().dateOfBirth('cust-1')).resolves.toBeUndefined();
    },
  );

  /**
   * A platform failure — realistically a missing `view_customers` scope — must NOT propagate. This read runs
   * for every signed-in shopper whatever they are paying with, so a throw here would refuse card payments
   * over a datum only buy-now-pay-later needs. It answers `undefined` and logs a `warn` naming the likely
   * cause; a method that actually needed the birthdate is then refused by the VENDOR, which names the field.
   */
  it('answers undefined and warns on a platform failure instead of refusing the payment', async () => {
    const captured = mockCustomers();
    captured.execute.mockRejectedValue({ statusCode: 403, message: 'Forbidden' });
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined as never);

    await expect(new CustomerReaderAdapter().dateOfBirth('cust-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toMatch(/view_customers/);
  });

  it('does not warn for an ordinary 404 — a cart may name a customer the project no longer has', async () => {
    const captured = mockCustomers();
    captured.execute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined as never);

    await expect(new CustomerReaderAdapter().dateOfBirth('missing')).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
