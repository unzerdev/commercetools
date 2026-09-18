/**
 * Test doubles for the orchestration specs: a fake `ProviderModule` whose handlers are all `jest.fn`
 * stubs, plus fake `CorePorts` and a fake `OrchestrationEnv`. The specs assert the dispatch (which
 * handler the orchestrator calls, with what) and the state-machine wiring, never a concrete provider.
 */
import { jest } from '@jest/globals';
import { PaymentState } from '../../src/domain';
import type { OperationResult, ProviderStatusInput } from '../../src/domain';
import type { CorePorts } from '../../src/application/ports';
import type { ProviderModule } from '../../src/application/handlers';
import type { OrchestrationEnv } from '../../src/application/orchestration';

/**
 * The vendor's answer to an operation it performed but did not name. A real vendor gives it, and the
 * handler passes the absence through rather than manufacturing an id, so the doubles must be able to too.
 */
export const unnamedOperationResult = (rawStatus: ProviderStatusInput): OperationResult => ({ rawStatus });

/** The commercetools custom-object key contract: alphanumerics plus `-_~.`, at most 256 characters. */
const CT_CUSTOM_OBJECT_KEY_PATTERN = /^[-_~.a-zA-Z0-9]+$/;

/** Throw when a key would be rejected by the commercetools custom-object API (charset or length). */
export function assertCtCustomObjectKey(key: string): void {
  if (!CT_CUSTOM_OBJECT_KEY_PATTERN.test(key) || key.length > 256) {
    throw new Error(`key '${key}' violates the commercetools custom-object key contract`);
  }
}

/**
 * The store's public webhook receiver in the shape the production resolver mints: three segments, the
 * last a 43-character base64url capability token. The value itself is fixed; the fake derives nothing.
 */
export const FAKE_WEBHOOK_URL = 'https://connector.test/webhooks/store-1/0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

/** A minimal CT-cart shape the fake `CartReader` returns (only the fields the orchestrators read). */
export function fakeCart(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'cart-1',
    version: 1,
    lineItems: [],
    totalPrice: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
    ...overrides,
  };
}

/** A minimal CT-payment shape the fake `PaymentStore` returns. */
export function fakePayment(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'pay-1',
    version: 1,
    amountPlanned: { centAmount: 1500, currencyCode: 'EUR', type: 'centPrecision', fractionDigits: 2 },
    interfaceId: 'vendor-pay-1',
    // commercetools always returns `paymentMethodInfo`; the connector stamps its own `paymentInterface`
    // there, which is how the order panel tells its payments from another PSP's.
    paymentMethodInfo: { paymentInterface: 'psp' },
    transactions: [],
    custom: { fields: {} },
    ...overrides,
  };
}

/** Build fake `CorePorts` - every port method is a `jest.fn` with a sensible default. */
export function makeFakePorts(): CorePorts {
  const cart = fakeCart();
  const payment = fakePayment();
  const ports: CorePorts = {
    configResolver: {
      resolve: jest.fn<CorePorts['configResolver']['resolve']>().mockResolvedValue({
        storeKey: 'store-1',
        // The fake store carries a connection of its OWN, which is the ordinary case; a suite about
        // default-scope inheritance says so by overriding this.
        inheritsDefaultScope: false,
        mode: 'sandbox',
        host: 'https://vendor.test',
        vendorHosts: { sandbox: 'https://vendor.test', live: 'https://vendor.test' },
        integrator: 'test',
        credentials: {},
        // Opaque provider settings - empty: this connector has no provider-owned settings document.
        settings: {},
        connector: { creator: 'Creator', name: 'test-commercetools', version: '0.0.0-test' },
        telemetry: { name: 'X-Telemetry' },
        endpoints: { webhookUrl: FAKE_WEBHOOK_URL },
        requestTimeoutMs: 30000,
        paymentTypeKey: 'psp-payment',
      }),
      resolveDefault: jest.fn<CorePorts['configResolver']['resolveDefault']>().mockResolvedValue({
        storeKey: 'store-1',
        // The fake store carries a connection of its OWN, which is the ordinary case; a suite about
        // default-scope inheritance says so by overriding this.
        inheritsDefaultScope: false,
        mode: 'sandbox',
        host: 'https://vendor.test',
        vendorHosts: { sandbox: 'https://vendor.test', live: 'https://vendor.test' },
        integrator: 'test',
        credentials: {},
        // Opaque provider settings - empty: this connector has no provider-owned settings document.
        settings: {},
        connector: { creator: 'Creator', name: 'test-commercetools', version: '0.0.0-test' },
        telemetry: { name: 'X-Telemetry' },
        endpoints: { webhookUrl: FAKE_WEBHOOK_URL },
        requestTimeoutMs: 30000,
        paymentTypeKey: 'psp-payment',
      }),
      storeKey: jest.fn<CorePorts['configResolver']['storeKey']>().mockReturnValue('store-1'),
    },
    configStore: {
      read: jest.fn<CorePorts['configStore']['read']>().mockResolvedValue(null),
      readWithVersion: jest
        .fn<CorePorts['configStore']['readWithVersion']>()
        .mockResolvedValue({ value: null, version: undefined }),
      // Echo the written (decrypted) document back, like the real repository does - a stub returning `{}`
      // would hide whatever the write response actually carries from every orchestration assertion.
      write: jest.fn<CorePorts['configStore']['write']>().mockImplementation(async (_storeKey, value) => value),
      delete: jest.fn<CorePorts['configStore']['delete']>().mockResolvedValue(undefined),
      clearEnvCredentials: jest.fn<CorePorts['configStore']['clearEnvCredentials']>().mockResolvedValue(null),
    },
    paymentMethodsStore: {
      readWithVersion: jest
        .fn<CorePorts['paymentMethodsStore']['readWithVersion']>()
        .mockResolvedValue({ value: null, version: undefined }),
      // Replaced below, once `ports` exists to delegate through.
      readEffective: jest.fn<CorePorts['paymentMethodsStore']['readEffective']>().mockResolvedValue(null),
      // Echo the written object back (bumping to version 1), like a first-create CT write would.
      write: jest.fn<CorePorts['paymentMethodsStore']['write']>().mockImplementation(async (_storeKey, value) => value),
      delete: jest.fn<CorePorts['paymentMethodsStore']['delete']>().mockResolvedValue(undefined),
    },
    projectStoreReader: {
      readStore: jest
        .fn<CorePorts['projectStoreReader']['readStore']>()
        .mockResolvedValue({ languages: ['en'], countries: ['NL'] }),
      readProjectSettings: jest
        .fn<CorePorts['projectStoreReader']['readProjectSettings']>()
        .mockResolvedValue({ languages: ['en', 'de'], currencies: ['EUR'], countries: ['NL', 'DE'] }),
      listStores: jest
        .fn<CorePorts['projectStoreReader']['listStores']>()
        .mockResolvedValue([{ key: 'store-1', name: 'Store One' }]),
      storeExists: jest.fn<CorePorts['projectStoreReader']['storeExists']>().mockResolvedValue(true),
    },
    cartReader: {
      currentCartId: jest.fn<CorePorts['cartReader']['currentCartId']>().mockReturnValue('cart-1'),
      getCart: jest.fn<CorePorts['cartReader']['getCart']>().mockResolvedValue(cart),
      getPaymentAmount: jest.fn<CorePorts['cartReader']['getPaymentAmount']>().mockResolvedValue({
        centAmount: 1500,
        currencyCode: 'EUR',
        type: 'centPrecision',
        fractionDigits: 2,
      } as never),
      addPayment: jest.fn<CorePorts['cartReader']['addPayment']>().mockResolvedValue(cart),
    },
    // The default is a customer with NO stored date of birth: the fallback exists, and a test that wants it
    // to answer says so, so no case silently depends on a profile value it did not ask for.
    customerReader: {
      dateOfBirth: jest.fn<CorePorts['customerReader']['dateOfBirth']>().mockResolvedValue(undefined),
    },
    paymentStore: {
      create: jest.fn<CorePorts['paymentStore']['create']>().mockResolvedValue(payment),
      update: jest.fn<CorePorts['paymentStore']['update']>().mockResolvedValue(payment),
      get: jest.fn<CorePorts['paymentStore']['get']>().mockResolvedValue(payment),
      findByMerchantReference: jest
        .fn<CorePorts['paymentStore']['findByMerchantReference']>()
        .mockResolvedValue(payment),
      findById: jest.fn<CorePorts['paymentStore']['findById']>().mockResolvedValue(payment),
      setReviewFlag: jest.fn<CorePorts['paymentStore']['setReviewFlag']>().mockResolvedValue(undefined),
      setStatus: jest.fn<CorePorts['paymentStore']['setStatus']>().mockResolvedValue(undefined),
      reserve: jest.fn<CorePorts['paymentStore']['reserve']>().mockResolvedValue(undefined),
      settle: jest.fn<CorePorts['paymentStore']['settle']>().mockResolvedValue(undefined),
      release: jest.fn<CorePorts['paymentStore']['release']>().mockResolvedValue(undefined),
      hasTransactionInState: jest.fn<CorePorts['paymentStore']['hasTransactionInState']>().mockReturnValue(false),
    },
    orderReader: {
      getWithPayments: jest.fn<CorePorts['orderReader']['getWithPayments']>().mockResolvedValue({
        id: 'order-1',
        payments: [payment],
      }),
    },
    markerStore: {
      claim: jest.fn<CorePorts['markerStore']['claim']>().mockImplementation(async (key: string) => {
        assertCtCustomObjectKey(key);
        return true;
      }),
      release: jest.fn<CorePorts['markerStore']['release']>().mockResolvedValue(undefined),
    },
    provisioning: {
      ensurePaymentType: jest.fn<CorePorts['provisioning']['ensurePaymentType']>().mockResolvedValue(undefined),
      ensurePaymentStates: jest.fn<CorePorts['provisioning']['ensurePaymentStates']>().mockResolvedValue(undefined),
      missingObjects: jest.fn<CorePorts['provisioning']['missingObjects']>().mockResolvedValue([]),
    },
    permissionsHealth: {
      commercetoolsPermissions: jest
        .fn<CorePorts['permissionsHealth']['commercetoolsPermissions']>()
        .mockReturnValue(async () => ({ name: 'CoCo permissions', status: 'UP' as const })),
    },
    crypto: {
      verifyWebhookUrlToken: jest.fn<CorePorts['crypto']['verifyWebhookUrlToken']>().mockReturnValue(true),
    },
  };

  // The DEFAULT-scope layer resolves to the store's OWN object here, so a suite that stubs
  // `readWithVersion` keeps describing the case it meant. A suite exercising the inheritance itself
  // overrides `readEffective` directly - which is what makes those cases visible rather than incidental.
  ports.paymentMethodsStore.readEffective = jest
    .fn<CorePorts['paymentMethodsStore']['readEffective']>()
    .mockImplementation(async (storeKey) => (await ports.paymentMethodsStore.readWithVersion(storeKey)).value);

  return ports;
}

/** Build a `FakeProviderModule` - every handler method is a `jest.fn`. Override members after building. */
export function makeFakeProviderModule(): ProviderModule {
  return {
    key: 'fake-psp',
    paymentCustomType: { key: 'fake', resourceTypeIds: ['payment'], name: { en: 'Fake' }, fieldDefinitions: [] },
    // Artwork for the card alone, so a spec can tell "this method has a logo" from "this one does not"
    // without a fixture directory behind it.
    methodLogos: {
      has: jest.fn<ProviderModule['methodLogos']['has']>().mockImplementation((code: string) => code === 'card'),
      read: jest
        .fn<ProviderModule['methodLogos']['read']>()
        .mockImplementation(async (code: string) =>
          code === 'card' ? { contentType: 'image/svg+xml', data: Buffer.from('<svg/>') } : undefined,
        ),
    },
    mapProviderStatus: jest.fn<ProviderModule['mapProviderStatus']>().mockReturnValue(PaymentState.INITIAL),
    config: {
      validate: jest.fn<ProviderModule['config']['validate']>().mockReturnValue({ valid: true }),
      missingConnectionFields: jest.fn<ProviderModule['config']['missingConnectionFields']>().mockReturnValue([]),
      redact: jest.fn<ProviderModule['config']['redact']>((stored) => stored as never),
      reconcileSecrets: jest.fn<ProviderModule['config']['reconcileSecrets']>((incoming) => incoming),
      shopperPublicKey: jest.fn<ProviderModule['config']['shopperPublicKey']>((cfg) => cfg.credentials.publicKey ?? ''),
    },
    payment: {
      pay: jest.fn<ProviderModule['payment']['pay']>().mockResolvedValue({
        providerPaymentId: 'vendor-charge-1',
        bookingMode: 'charge',
        action: { kind: 'none' },
        rawStatus: { state: PaymentState.AUTHORIZED },
        customFields: { typeKey: 'psp-payment', fields: { pspPaymentId: 'vendor-charge-1' } },
      }),
    },
    modifications: {
      // The default plan is the shape a vendor that refunds the payment as a whole answers with: ONE
      // slice naming no target, for exactly what was asked. Every existing money-path spec therefore
      // keeps its single reserve/call/settle sequence; a spec that wants the multi-operation path
      // overrides this with several slices.
      planRefund: jest
        .fn<ProviderModule['modifications']['planRefund']>()
        .mockImplementation(async (_cfg, req) => [{ amount: req.amount }]),
      capture: jest
        .fn<ProviderModule['modifications']['capture']>()
        .mockResolvedValue({ providerOperationId: 'cap-1', rawStatus: { state: PaymentState.CAPTURED } }),
      // A cancel names no operation of its own at the vendor: the vendor's `CancelPaymentResponse` is
      // `{ payment }`, so `modification.handler.ts` surfaces the PAYMENT id as the operation id - the very
      // id the Authorization leg already carries. The fake answers the same, because a settle that only
      // ever saw an id no other leg holds cannot witness the guard that compares them.
      cancel: jest
        .fn<ProviderModule['modifications']['cancel']>()
        .mockResolvedValue({ providerOperationId: 'vendor-pay-1', rawStatus: { state: PaymentState.CANCELLED } }),
      refund: jest
        .fn<ProviderModule['modifications']['refund']>()
        .mockResolvedValue({ providerOperationId: 'ref-1', rawStatus: { state: PaymentState.REFUNDED } }),
    },
    returnLeg: {
      readContext: jest
        .fn<ProviderModule['returnLeg']['readContext']>()
        .mockReturnValue({ shopperReturnUrl: 'https://shop.test/return', providerContext: { mac: 'm' } }),
      resolve: jest.fn<ProviderModule['returnLeg']['resolve']>().mockResolvedValue({
        providerPaymentId: 'vendor-def-1',
        rawStatus: { state: PaymentState.CAPTURED },
        action: { kind: 'none' },
      }),
    },
    introspection: {
      statusChecks: jest.fn<ProviderModule['introspection']['statusChecks']>().mockResolvedValue([]),
      availableMethods: jest.fn<ProviderModule['introspection']['availableMethods']>().mockResolvedValue([]),
      testConnection: jest.fn<ProviderModule['introspection']['testConnection']>().mockResolvedValue({ success: true }),
      paymentDetails: jest.fn<ProviderModule['introspection']['paymentDetails']>().mockResolvedValue({
        displayStatus: 'CAPTURED',
        // The vendor's own order reference on the payment, echoed back verbatim on the read.
        orderId: 'ct-pay-1',
        amounts: {
          total: { centAmount: 1500, currencyCode: 'EUR' },
          charged: { centAmount: 1500, currencyCode: 'EUR' },
        },
        operations: [
          {
            id: 'cap-1',
            type: 'charge',
            date: '2026-07-10T10:00:00.000Z',
            outcome: 'success',
            amount: { centAmount: 1500, currencyCode: 'EUR' },
            rawStatus: { state: PaymentState.CAPTURED },
          },
        ],
      }),
      supportedComponents: jest.fn<ProviderModule['introspection']['supportedComponents']>().mockReturnValue([]),
      supportedDropins: jest.fn<ProviderModule['introspection']['supportedDropins']>().mockReturnValue([]),
    },
    surface: {
      /**
       * The static surface traits, mirroring the real provider's sets so a spec about `paylater-invoice`
       * or the wallets behaves like production without importing the provider.
       */
      traits: jest.fn<ProviderModule['surface']['traits']>().mockImplementation((code: string) => ({
        requiresCustomerData: code.startsWith('paylater-') || code === 'klarna',
        needsAmountData: code === 'paylater-installment',
        rendersOwnPayButton: code === 'applepay' || code === 'googlepay',
        carriesClickToPay: code === 'card',
      })),
      /**
       * The wallet payload, echoing its input rather than reproducing the vendor's shape: a spec about the
       * orchestration needs to see which values core assembled, and the vendor's own object is pinned where
       * it is built.
       */
      walletData: jest
        .fn<ProviderModule['surface']['walletData']>()
        .mockImplementation((code, input) =>
          code === 'applepay' || code === 'googlepay'
            ? { kind: code as 'applepay' | 'googlepay', payload: { ...input } }
            : undefined,
        ),
    },
    webhook: {
      parse: jest.fn<ProviderModule['webhook']['parse']>().mockResolvedValue({
        kind: 'payment.captured',
        paymentRef: 'ref',
        providerPaymentId: 'vendor-pay-1',
        operationId: 'op-1',
        rawStatus: { state: PaymentState.CAPTURED },
      }),
      registerWebhooks: jest.fn<ProviderModule['webhook']['registerWebhooks']>().mockResolvedValue([]),
      deleteWebhooks: jest.fn<ProviderModule['webhook']['deleteWebhooks']>().mockResolvedValue(undefined),
    },
  };
}

/** A fake `OrchestrationEnv` - the ambient deployment config, injectable per test. */
export function makeFakeEnv(overrides: Partial<OrchestrationEnv> = {}): OrchestrationEnv {
  const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    brand: { paymentInterface: 'psp' },
    allowedReturnOrigins: ['https://shop.test'],
    returnUrl: 'https://connector.test/return',
    returnFailureUrl: 'https://shop.test/failed',
    status: {
      logger: noopLogger as never,
      timeout: 5000,
      requiredPermissions: ['manage_payments'],
      metadata: { name: 'connector' },
    },
    ...overrides,
  };
}
