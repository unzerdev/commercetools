/**
 * the PLAINTEXT payment-methods Custom Object repository.
 *
 * A separate Custom Object from the connection config (container
 * `unzer-connector-payment-methods`, key = store key) holding NO secrets, so — unlike
 * `store-config.repository` — it neither encrypts on write nor decrypts on read: the persisted value
 * is the domain object verbatim. `readWithVersion` returns the value + CT `version` in one GET (404 →
 * `null`); `write` upserts with an optional CAS `version`; `delete` removes the object outright (the
 * disconnect of the last environment) and tolerates a 404 so it is idempotent.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { getBrand } from '../src/infrastructure/config/brand';
import {
  deletePaymentMethodsObject,
  readEffectivePaymentMethods,
  readPaymentMethodsWithVersion,
  writePaymentMethodsObject,
} from '../src/infrastructure/persistence/payment-methods.repository';
import type { PaymentMethodsObject } from '../src/domain';

/** The payment-methods container is resolved from the brand defaults. */
const PAYMENT_METHODS_CONTAINER = getBrand().paymentMethodsContainer;

const sampleObject = (): PaymentMethodsObject => ({
  store: 'store-a',
  environments: {
    sandbox: {
      paymentMethods: [
        {
          paymentMethodCode: 'card',
          enabled: true,
          name: { en: 'Card' },
          description: { en: 'Pay by card' },
          bookingMode: 'authorize',
          minAmount: { EUR: 100 },
          maxAmount: { EUR: 500000 },
          surcharge: { EUR: 50 },
          countries: ['DE'],
          sendBasketData: false,
        },
      ],
    },
  },
});

interface Captured {
  containerKey?: { container: string; key: string };
  postBody?: { container: string; key: string; value: PaymentMethodsObject; version?: number };
  deleteArgs?: { queryArgs?: { version?: number } };
  container?: string;
  queryArgs?: { where?: string; limit?: number; 'var.keys'?: string[] };
  getExecute: jest.Mock<() => Promise<unknown>>;
  queryExecute: jest.Mock<() => Promise<unknown>>;
  postExecute: jest.Mock<() => Promise<unknown>>;
  deleteExecute: jest.Mock<() => Promise<unknown>>;
}

function mockCustomObjects(): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>(),
    queryExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>(),
    deleteExecute: jest.fn<() => Promise<unknown>>(),
  };
  const builder = {
    withContainerAndKey: (args: { container: string; key: string }) => {
      captured.containerKey = args;
      return {
        get: () => ({ execute: captured.getExecute }),
        delete: (deleteArgs: Captured['deleteArgs']) => {
          captured.deleteArgs = deleteArgs;
          return { execute: captured.deleteExecute };
        },
      };
    },
    withContainer: (args: { container: string }) => {
      captured.container = args.container;
      return {
        get: (getArgs: { queryArgs: Captured['queryArgs'] }) => {
          captured.queryArgs = getArgs.queryArgs;
          return { execute: captured.queryExecute };
        },
      };
    },
    post: (args: { body: Captured['postBody'] }) => {
      captured.postBody = args.body;
      return { execute: captured.postExecute };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'customObjects').mockReturnValue(builder as never);
  return captured;
}

describe('config/payment-methods.repository', () => {
  beforeEach(() => {
    // No ENCRYPTION_KEY needed — the payment-methods object is plaintext.
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('writePaymentMethodsObject', () => {
    it('targets the fixed payment-methods container and the storeKey', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await writePaymentMethodsObject('store-a', sampleObject());

      expect(captured.postBody?.container).toBe(PAYMENT_METHODS_CONTAINER);
      expect(PAYMENT_METHODS_CONTAINER).toBe('unzer-connector-payment-methods');
      expect(captured.postBody?.key).toBe('store-a');
    });

    it('persists the value verbatim — no encryption of any leaf', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      const input = sampleObject();
      await writePaymentMethodsObject('store-a', input);

      expect(captured.postBody!.value).toEqual(input);
    });

    it('passes the version through for optimistic concurrency (CAS) on update', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 8, value: {} } });

      await writePaymentMethodsObject('store-a', sampleObject(), 7);

      expect(captured.postBody?.version).toBe(7);
    });

    it('omits version on a first create (no CAS argument)', async () => {
      const captured = mockCustomObjects();
      captured.postExecute.mockResolvedValue({ body: { version: 1, value: {} } });

      await writePaymentMethodsObject('store-a', sampleObject());

      expect(captured.postBody).not.toHaveProperty('version');
    });
  });

  /**
   * The DEFAULT-scope layer: a store that was never configured on its own offers the methods the
   * merchant configured on `__default__`, the same inheritance its credentials already follow.
   * Both layers come back in ONE parameterized `key in :keys` query, so the money path gains no
   * round-trip and no store key is ever spliced into the predicate string.
   */
  describe('readEffectivePaymentMethods', () => {
    const objectFor = (key: string) => ({ key, value: { ...sampleObject(), store: key }, version: 1 });

    it('reads BOTH layers in one query against the payment-methods container', async () => {
      const captured = mockCustomObjects();
      captured.queryExecute.mockResolvedValue({ body: { results: [] } });

      await readEffectivePaymentMethods('store-a', true);

      expect(captured.container).toBe(PAYMENT_METHODS_CONTAINER);
      expect(captured.queryArgs?.where).toBe('key in :keys');
      expect(captured.queryArgs?.['var.keys']).toEqual(['__default__', 'store-a']);
      expect(captured.queryArgs?.limit).toBe(2);
    });

    it("prefers the store's own object over the default scope's", async () => {
      const captured = mockCustomObjects();
      captured.queryExecute.mockResolvedValue({ body: { results: [objectFor('__default__'), objectFor('store-a')] } });

      await expect(readEffectivePaymentMethods('store-a', true)).resolves.toMatchObject({ store: 'store-a' });
    });

    it('falls back to the default scope when the store has no object of its own', async () => {
      const captured = mockCustomObjects();
      captured.queryExecute.mockResolvedValue({ body: { results: [objectFor('__default__')] } });

      await expect(readEffectivePaymentMethods('store-a', true)).resolves.toMatchObject({ store: '__default__' });
    });

    it('answers null when neither layer exists — the caller then falls back to the env baseline', async () => {
      const captured = mockCustomObjects();
      captured.queryExecute.mockResolvedValue({ body: { results: [] } });

      await expect(readEffectivePaymentMethods('store-a', true)).resolves.toBeNull();
    });

    // Reading the default scope ITSELF must not need a second layer: the query collapses to one key.
    it('queries a single key when the target IS the default scope', async () => {
      const captured = mockCustomObjects();
      captured.queryExecute.mockResolvedValue({ body: { results: [objectFor('__default__')] } });

      await expect(readEffectivePaymentMethods('__default__', true)).resolves.toMatchObject({ store: '__default__' });
      expect(captured.queryArgs?.where).toBe('key in :keys');
      expect(captured.queryArgs?.['var.keys']).toEqual(['__default__']);
    });

    /**
     * A store CONNECTED on its own account inherits nothing. Per-method configuration is written
     * against a KEYPAIR — the codes that account serves, the booking mode each accepts, the priced
     * surcharges — so inheriting would apply one account's answers to another account's methods.
     */
    it('reads the store’s own key alone when it does not inherit the default scope', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockResolvedValue({ body: objectFor('store-a') });

      await expect(readEffectivePaymentMethods('store-a', false)).resolves.toMatchObject({ store: 'store-a' });

      expect(captured.containerKey).toEqual({ container: PAYMENT_METHODS_CONTAINER, key: 'store-a' });
      expect(captured.queryExecute).not.toHaveBeenCalled();
    });

    // A store with its own connection and no object of its own starts from NOTHING — never the default's.
    it('answers null for a non-inheriting store with no object, whatever the default scope holds', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));

      await expect(readEffectivePaymentMethods('store-a', false)).resolves.toBeNull();
      expect(captured.queryExecute).not.toHaveBeenCalled();
    });
  });

  describe('deletePaymentMethodsObject', () => {
    it('deletes the store’s object from the payment-methods container, CAS on the version', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockResolvedValue({ body: {} });

      await deletePaymentMethodsObject('store-a', 6);

      expect(captured.containerKey).toEqual({ container: PAYMENT_METHODS_CONTAINER, key: 'store-a' });
      expect(captured.deleteArgs).toEqual({ queryArgs: { version: 6 } });
    });

    it('omits the CAS argument when no version is known', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockResolvedValue({ body: {} });

      await deletePaymentMethodsObject('store-a');

      expect(captured.deleteArgs).toEqual({});
    });

    it('tolerates a missing object so the disconnect stays idempotent', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(deletePaymentMethodsObject('missing')).resolves.toBeUndefined();
    });

    it('re-throws non-404 errors', async () => {
      const captured = mockCustomObjects();
      captured.deleteExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(deletePaymentMethodsObject('store-a')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('readPaymentMethodsWithVersion', () => {
    it('returns the value AND the version in a single GET', async () => {
      const captured = mockCustomObjects();
      const stored = sampleObject();
      captured.getExecute.mockResolvedValue({ body: { version: 6, value: stored } });

      const result = await readPaymentMethodsWithVersion('store-a');

      expect(result).toEqual({ value: stored, version: 6 });
      expect(captured.getExecute).toHaveBeenCalledTimes(1);
      expect(captured.containerKey).toEqual({ container: PAYMENT_METHODS_CONTAINER, key: 'store-a' });
    });

    it('returns { value: null, version: undefined } when the object does not exist', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 404, message: 'Not Found' });

      await expect(readPaymentMethodsWithVersion('missing')).resolves.toEqual({ value: null, version: undefined });
    });

    it('re-throws non-404 errors', async () => {
      const captured = mockCustomObjects();
      captured.getExecute.mockRejectedValue({ statusCode: 500, message: 'Boom' });

      await expect(readPaymentMethodsWithVersion('store-a')).rejects.toMatchObject({ statusCode: 500 });
    });
  });
});
