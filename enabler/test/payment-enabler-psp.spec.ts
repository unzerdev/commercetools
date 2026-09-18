import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PspPaymentEnabler } from '../src/payment-enabler/payment-enabler-psp';
import { UnzerMethodBuilder } from '../src/components/unzer/unzer-method';
import { UnzerEmbeddedDropinBuilder, UnzerMethodListBuilder } from '../src/components/unzer/method-list';
import { DropinType } from '../src/payment-enabler/payment-enabler';
import { errorResponse, FetchMock, installFetchMock, okJson, readCall } from './helpers';

const PROCESSOR_URL = 'https://proc.example';
const SESSION_ID = 'sess-123';

const cardConfig = {
  publicKey: 's-pub-abc',
  environment: 'sandbox',
  locale: 'en-GB',
  paymentMethods: [
    { code: 'card', name: 'Credit card', description: 'Pay by card', surcharge: 0, requiresCustomerData: false },
  ],
};

describe('PspPaymentEnabler', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    // The SDK loader resolves immediately once its wrapper element is registered — so setup never
    // awaits a real CDN load in the test environment.
    if (!customElements.get('unzer-payment')) {
      customElements.define('unzer-payment', class extends HTMLElement {});
    }
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Queue the one setup response (payment-config) and construct.
  const newEnabler = (opts: { config?: unknown } = {}) => {
    fetchMock.mockResolvedValueOnce(okJson(opts.config ?? cardConfig));
    return new PspPaymentEnabler({ processorUrl: PROCESSOR_URL, sessionId: SESSION_ID });
  };

  describe('setup', () => {
    it('fetches GET /operations/payment-config with the X-Session-Id header', async () => {
      const enabler = newEnabler();
      await enabler.setupData;

      const configCall = readCall(fetchMock, 0);
      expect(configCall.url).toBe(`${PROCESSOR_URL}/operations/payment-config`);
      expect(configCall.method).toBe('GET');
      expect(configCall.headers['X-Session-Id']).toBe(SESSION_ID);
    });

    it('parses the config body onto baseOptions', async () => {
      const enabler = newEnabler();
      const { baseOptions } = await enabler.setupData;

      expect(baseOptions.config.publicKey).toBe('s-pub-abc');
      expect(baseOptions.config.locale).toBe('en-GB');
      expect(baseOptions.config.paymentMethods).toEqual([
        {
          code: 'card',
          name: 'Credit card',
          description: 'Pay by card',
          surcharge: 0,
          requiresCustomerData: false,
          needsAmountData: false,
          rendersOwnPayButton: false,
        },
      ]);
    });

    it('resolves the shopper texts from the CONFIG locale, not from the host-supplied one', async () => {
      // The host asks for French while the session cart is German. The cart wins: `config.locale` is the
      // authoritative display language, and `EnablerOptions.locale` governs only the vendor
      // customer's language on the payment request.
      fetchMock.mockResolvedValueOnce(okJson({ ...cardConfig, locale: 'de-DE' }));
      const enabler = new PspPaymentEnabler({ processorUrl: PROCESSOR_URL, sessionId: SESSION_ID, locale: 'fr' });

      const { baseOptions } = await enabler.setupData;

      expect(baseOptions.texts.noPaymentMethods).toBe('Für diese Bestellung stehen keine Zahlungsarten zur Verfügung.');
      expect(baseOptions.locale).toBe('fr');
    });

    it('falls back to the English texts when the config carries no locale', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ ...cardConfig, locale: '' }));
      const enabler = new PspPaymentEnabler({ processorUrl: PROCESSOR_URL, sessionId: SESSION_ID });

      const { baseOptions } = await enabler.setupData;

      expect(baseOptions.texts.noPaymentMethods).toBe('No payment methods are available for this order.');
    });

    it('rejects setup when the config fetch is not ok', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401));
      const enabler = new PspPaymentEnabler({ processorUrl: PROCESSOR_URL, sessionId: SESSION_ID });
      await expect(enabler.setupData).rejects.toThrow(/Failed to fetch processor config \(status 401\)/);
    });

    it('issues the config read and nothing else', async () => {
      const enabler = newEnabler();
      await enabler.setupData;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('normalizes a trailing-slash processorUrl to single-slash request URLs', async () => {
      fetchMock.mockResolvedValueOnce(okJson(cardConfig));
      const enabler = new PspPaymentEnabler({ processorUrl: `${PROCESSOR_URL}/`, sessionId: SESSION_ID });
      const { baseOptions } = await enabler.setupData;

      expect(readCall(fetchMock, 0).url).toBe(`${PROCESSOR_URL}/operations/payment-config`);
      // The base URL is normalized once here, so the `POST /payments` call site that reads it from
      // baseOptions also concatenates against a slash-free base.
      expect(baseOptions.processorUrl).toBe(PROCESSOR_URL);
    });
  });

  describe('builders', () => {
    it('builds an Unzer method component builder for a configured, mappable method', async () => {
      const enabler = newEnabler();
      const builder = await enabler.createComponentBuilder('card');
      expect(builder).toBeInstanceOf(UnzerMethodBuilder);
      expect(builder.componentHasSubmit).toBe(true);
    });

    it('throws for a method the config did not return', async () => {
      const enabler = newEnabler();
      await expect(enabler.createComponentBuilder('paypal')).rejects.toThrow(/Component type not supported: paypal/);
    });

    it('throws for a configured method with no Unzer element mapping', async () => {
      const enabler = newEnabler({
        config: {
          ...cardConfig,
          paymentMethods: [{ code: 'no-such', name: 'X', description: '', surcharge: 0, requiresCustomerData: false }],
        },
      });
      await expect(enabler.createComponentBuilder('no-such')).rejects.toThrow(/Component type not supported: no-such/);
    });

    it('builds the composite `unzer` component, which answers submit(), without it being a configured method', async () => {
      const enabler = newEnabler();
      const builder = await enabler.createComponentBuilder('unzer');
      expect(builder).toBeInstanceOf(UnzerMethodListBuilder);
      expect(builder.componentHasSubmit).toBe(true);
    });

    it('builds the embedded drop-in, which answers submit()', async () => {
      const enabler = newEnabler();
      const builder = await enabler.createDropinBuilder(DropinType.embedded);
      expect(builder).toBeInstanceOf(UnzerEmbeddedDropinBuilder);
      expect(builder.dropinHasSubmit).toBe(true);
    });

    it('still refuses the hosted-page drop-in types', async () => {
      const enabler = newEnabler();
      await expect(enabler.createDropinBuilder(DropinType.hpp)).rejects.toThrow(/Dropin type not supported: hpp/);
      await expect(enabler.createDropinBuilder(DropinType.hppPreselected)).rejects.toThrow(/Dropin type not supported/);
    });

    // The processor's wire schema narrows the drop-in type to these same three literals; each app pins its own
    // contract, so a fourth value added on one side fails a test on that side.
    it('DropinType carries exactly embedded, hpp and hpp-preselected', () => {
      expect(Object.values(DropinType).sort()).toEqual(['embedded', 'hpp', 'hpp-preselected']);
    });

    it('has no express components', async () => {
      const enabler = newEnabler();
      await expect(enabler.createExpressBuilder('applepay')).rejects.toThrow(/no express components/);
    });
  });
});
