/**
 * `reflectReturn` dispatch and fail-closed behaviour, exercised with fake
 * ports + a fake provider.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { PaymentState } from '../src/domain';
import { reflectReturn } from '../src/application/orchestration';
import { fakePayment, makeFakeEnv, makeFakePorts, makeFakeProviderModule } from './support/fake-provider-module';
import { statefulPaymentStore } from './support/in-memory-payment-store';

describe('orchestration/reflectReturn', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('valid return: reads the opaque context, resolves it, reflects CAPTURED → Charge:Success, redirects approved', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const res = await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    // The opaque provider context reaches resolve verbatim, together with the raw query.
    expect(provider.returnLeg.readContext).toHaveBeenCalledTimes(1);
    expect(provider.returnLeg.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: expect.objectContaining({ ctPaymentId: 'pay-1' }), context: { mac: 'm' } }),
    );
    expect(ports.paymentStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        pspReference: 'vendor-def-1',
        transaction: expect.objectContaining({ type: 'Charge', state: 'Success' }),
      }),
    );
    expect(res.redirectUrl).toBe('https://shop.test/return?status=approved');
  });

  /**
   * The return leg learns a status too, so it writes the page's PSP Status Code and Payment state as its last
   * act. Asserted at the orchestration level because the helper's own spec stays green with the
   * call site deleted, and the fields then read `-` for every redirect shopper.
   */
  test('the vendor status code, its text and the payment state are written from the resolved return', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    provider.returnLeg.resolve = jest.fn<typeof provider.returnLeg.resolve>().mockResolvedValue({
      providerPaymentId: 'vendor-def-1',
      rawStatus: { state: 'CAPTURED' },
      action: { kind: 'none' },
      statusCode: { code: 'COR.000.100.112', text: 'Your payment has been processed.' },
    });

    await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    expect(ports.paymentStore.setStatus).toHaveBeenCalledWith('pay-1', {
      interfaceCode: 'COR.000.100.112',
      interfaceText: 'Your payment has been processed.',
      stateKey: 'completed',
    });
  });

  test('fail-closed: a resolve throw writes nothing to CT and redirects to the uniform failure URL', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    provider.returnLeg.resolve = jest
      .fn<typeof provider.returnLeg.resolve>()
      .mockRejectedValue(new Error('RETURNMAC verification failed'));

    const res = await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'x' } }, { ports, provider });

    expect(ports.paymentStore.update).not.toHaveBeenCalled();
    expect(res.redirectUrl).toBe('https://shop.test/failed');
  });

  test('an EMPTY allowlist honours the stored shopper URL on the 302, whatever its origin', async () => {
    const openEnv = makeFakeEnv({ allowedReturnOrigins: [] });
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    provider.returnLeg.readContext = jest
      .fn<typeof provider.returnLeg.readContext>()
      .mockReturnValue({ shopperReturnUrl: 'https://other-shop.test/return', providerContext: { mac: 'm' } });

    const res = await reflectReturn(
      { env: openEnv, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } },
      { ports, provider },
    );

    expect(res.redirectUrl).toBe('https://other-shop.test/return?status=approved');
  });

  test('an EMPTY allowlist still sends a non-http(s) stored URL to the failure sink, never into a 302', async () => {
    const openEnv = makeFakeEnv({ allowedReturnOrigins: [] });
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    provider.returnLeg.readContext = jest
      .fn<typeof provider.returnLeg.readContext>()
      .mockReturnValue({ shopperReturnUrl: 'javascript:alert(1)', providerContext: { mac: 'm' } });

    const res = await reflectReturn(
      { env: openEnv, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } },
      { ports, provider },
    );

    expect(res.redirectUrl).toBe('https://shop.test/failed');
  });

  test('missing ctPaymentId → throws, no payment lookup, no resolve', async () => {
    await expect(reflectReturn({ env, query: {} }, { ports, provider })).rejects.toBeDefined();
    expect(ports.paymentStore.get).not.toHaveBeenCalled();
    expect(provider.returnLeg.resolve).not.toHaveBeenCalled();
  });

  test('config is resolved FROM THE PAYMENT stamp: a payment in store-42 resolves store-42 (not resolveDefault)', async () => {
    ports.paymentStore.get = jest
      .fn<typeof ports.paymentStore.get>()
      .mockResolvedValue(fakePayment({ custom: { fields: { storeKey: 'store-42' } } }));

    await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-42');
    expect(ports.configResolver.resolveDefault).not.toHaveBeenCalled();
    // The store-42 config — not the deployment default — is what the provider verifies the return with.
    expect(provider.returnLeg.resolve).toHaveBeenCalledTimes(1);
  });

  test('a payment with no stamped store key falls back to resolveDefault (legacy payment)', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());

    await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    expect(ports.configResolver.resolveDefault).toHaveBeenCalledTimes(1);
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
  });

  test('fail-closed: a config-resolution throw writes nothing to CT and redirects to the uniform failure URL', async () => {
    ports.paymentStore.get = jest.fn<typeof ports.paymentStore.get>().mockResolvedValue(fakePayment());
    ports.configResolver.resolveDefault = jest
      .fn<typeof ports.configResolver.resolveDefault>()
      .mockRejectedValue(new Error('config unavailable'));

    const res = await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'x' } }, { ports, provider });

    expect(ports.paymentStore.update).not.toHaveBeenCalled();
    expect(provider.returnLeg.resolve).not.toHaveBeenCalled();
    expect(res.redirectUrl).toBe('https://shop.test/failed');
  });
});

/**
 * The return leg lands on the leg the CREATE call opened. The create leg recorded the accepted operation as
 * `Pending` under the vendor's operation id; the re-read here keys its write on that same id, so a settled answer
 * moves that leg and a still-open answer leaves it standing, neither of them appending a twin.
 */
describe('orchestration/reflectReturn: the leg the create call opened', () => {
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;
  const env = makeFakeEnv();

  const openedLeg = {
    id: 'tx-1',
    type: 'Charge',
    state: 'Pending',
    amount: { centAmount: 1500, currencyCode: 'EUR' },
    interactionId: 'vendor-def-1',
  };

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
  });

  test('a still-open re-read writes no transaction and redirects the shopper as pending', async () => {
    ports.paymentStore.get = jest
      .fn<typeof ports.paymentStore.get>()
      .mockResolvedValue(fakePayment({ transactions: [openedLeg] }));
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.REDIRECTED);

    const res = await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    const written = ((ports.paymentStore.update as jest.Mock).mock.calls[0] as [Record<string, unknown>])[0];
    expect(written).not.toHaveProperty('transaction');
    expect(res.redirectUrl).toBe('https://shop.test/return?status=pending');
  });

  test('a settled re-read moves the create-time Pending leg in place, one leg', async () => {
    const store = statefulPaymentStore(fakePayment({ transactions: [openedLeg] }));
    ports.paymentStore = store.port;
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);

    const res = await reflectReturn({ env, query: { ctPaymentId: 'pay-1', RETURNMAC: 'm' } }, { ports, provider });

    expect(res.redirectUrl).toBe('https://shop.test/return?status=approved');
    expect(store.current().transactions).toHaveLength(1);
    expect(store.current().transactions[0]).toMatchObject({
      type: 'Charge',
      state: 'Success',
      interactionId: 'vendor-def-1',
    });
  });
});
