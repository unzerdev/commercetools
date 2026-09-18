import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { PaymentState } from '../src/domain';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { registerRawBodyParser } from '../src/infrastructure/http/server/server';
import { webhookRoutes } from '../src/infrastructure/http/routes/vendor/webhook.route';
import {
  assertCtCustomObjectKey,
  makeFakeEnv,
  makeFakePorts,
  makeFakeProviderModule,
} from './support/fake-provider-module';

/**
 * The public webhook receiver: `POST /webhooks/:storeKey/:token` must be PUBLIC — no
 * session/oauth preHandler — because authenticity is the capability-URL token gate INSIDE
 * `handleWebhook` (fail-closed, a pure crypto compare via the crypto port before any I/O). This
 * suite mirrors the production wiring on a bare Fastify: error handler + raw-body parser + the route
 * with fake `CorePorts`/`ProviderModule`/env, and asserts the outcome→HTTP contract —
 * `unauthorized` → 401, `processed`/`duplicate`/`ignored` → 200, a THROW → 5xx so the vendor
 * redelivers (never a 200 on a failed reconcile) — plus the token plumbing: the route hands the
 * PATH token to the orchestration, a wrong token 401s with the SAME body as an unknown store, and
 * the tokenless path no longer exists.
 */
describe('webhook.route (public POST /webhooks/:storeKey/:token)', () => {
  let fastify: FastifyInstance;
  let ports: ReturnType<typeof makeFakePorts>;
  let provider: ReturnType<typeof makeFakeProviderModule>;

  // The token the fake crypto port accepts for `store-xyz` — the spec's stand-in for the derived MAC.
  const VALID_TOKEN = 'tok-valid';

  // An Unzer-shaped notification: event name + publicKey + resource pointer, NO signature header
  // (Unzer does not sign deliveries). Insignificant whitespace proves the parsed bytes are the SENT
  // bytes, not a re-serialization (the raw-body parser's whole point).
  const PAYLOAD =
    '{"event":"charge.succeeded",  "publicKey":"s-pub-test","paymentId":"s-pay-1",' +
    '"retrieveUrl":"https://sbx-api.unzer.com/v1/payments/s-pay-1/charges/op-1"}';

  async function buildApp(env = makeFakeEnv()): Promise<void> {
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    registerRawBodyParser(fastify);
    await fastify.register(webhookRoutes, { ports, provider, env });
    await fastify.ready();
  }

  function inject(storeKey = 'store-xyz', token = VALID_TOKEN) {
    return fastify.inject({
      method: 'POST',
      url: `/webhooks/${storeKey}/${token}`,
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
  }

  beforeEach(() => {
    ports = makeFakePorts();
    provider = makeFakeProviderModule();
    // The gate the orchestration consults: only `store-xyz`'s own token verifies, like the real
    // per-store MAC derivation — so a foreign or garbled token exercises the fail-closed path.
    ports.crypto.verifyWebhookUrlToken = jest
      .fn<typeof ports.crypto.verifyWebhookUrlToken>()
      .mockImplementation((storeKey, candidate) => storeKey === 'store-xyz' && candidate === VALID_TOKEN);
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('an Unzer-shaped body (no signature header) on the token path → 200 processed', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    await buildApp();

    const response = await inject();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'processed' });
    // The gate ran on the PATH pair — store key AND token both come from the route.
    expect(ports.crypto.verifyWebhookUrlToken).toHaveBeenCalledWith('store-xyz', VALID_TOKEN);
    // The store key comes from the ROUTE PATH, never the ambient env store key.
    expect(ports.configResolver.resolve).toHaveBeenCalledWith('store-xyz');
    // The Buffer `parse` reads is byte-identical to what was posted (the raw-body parser's point).
    expect(provider.webhook.parse).toHaveBeenCalledWith(
      Buffer.from(PAYLOAD, 'utf8'),
      expect.objectContaining({ storeKey: 'store-1' }),
    );
    expect(ports.paymentStore.update).toHaveBeenCalled();
  });

  test('wrong token → 401 before any CT or vendor call, with no body leak beyond the outcome', async () => {
    await buildApp();

    const response = await inject('store-xyz', 'tok-forged');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ outcome: 'unauthorized' });
    // Fail-closed BEFORE any I/O: no config resolve, no parse, no write (amplification defense).
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(provider.webhook.parse).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('unknown store answers 401 with the SAME body as a wrong token: the token gate refuses both', async () => {
    await buildApp();

    const wrongToken = await inject('store-xyz', 'tok-forged');
    // The token only derives for `store-xyz`, so an unknown store fails the SAME gate — no resolve runs.
    const unknownStore = await inject('no-such-store');

    expect(unknownStore.statusCode).toBe(401);
    // Indistinguishable to the caller: byte-identical bodies for both rejection causes.
    expect(unknownStore.body).toBe(wrongToken.body);
    expect(unknownStore.json()).toEqual({ outcome: 'unauthorized' });
    expect(ports.configResolver.resolve).not.toHaveBeenCalled();
    expect(provider.webhook.parse).not.toHaveBeenCalled();
  });

  test('an infrastructure fault during config resolution → 5xx so the vendor redelivers (never a 401)', async () => {
    // Resolution never throws for an unknown store (the CT 404 maps to `null`), so a rejection here
    // is a CT outage / fail-closed decrypt: the route must 5xx to keep the vendor redelivering.
    ports.configResolver.resolve = jest
      .fn<typeof ports.configResolver.resolve>()
      .mockRejectedValue(new Error('commercetools is unreachable'));
    await buildApp();

    const response = await inject();

    expect(response.statusCode).toBe(500);
    expect(provider.webhook.parse).not.toHaveBeenCalled();
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('the tokenless path /webhooks/:storeKey no longer exists → 404', async () => {
    await buildApp();

    const response = await fastify.inject({
      method: 'POST',
      url: '/webhooks/store-xyz',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });

    expect(response.statusCode).toBe(404);
    expect(ports.crypto.verifyWebhookUrlToken).not.toHaveBeenCalled();
  });

  test('duplicate delivery (marker claim lost) → 200 no-op', async () => {
    // A SETTLED status, because the marker is only claimed for an event that would record something.
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    // The duplicate stub still validates the key like the guarded fake it replaces.
    ports.markerStore.claim = jest.fn<typeof ports.markerStore.claim>().mockImplementation(async (key) => {
      assertCtCustomObjectKey(key);
      return false;
    });
    await buildApp();

    const response = await inject();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'duplicate' });
    expect(ports.paymentStore.update).not.toHaveBeenCalled();
  });

  test('processing failure (CT update rejects) → 5xx so the vendor redelivers, never a 200', async () => {
    provider.mapProviderStatus = jest.fn<typeof provider.mapProviderStatus>().mockReturnValue(PaymentState.CAPTURED);
    ports.paymentStore.update = jest
      .fn<typeof ports.paymentStore.update>()
      .mockRejectedValue(new Error('CT update failed'));
    await buildApp();

    const response = await inject();

    expect(response.statusCode).toBe(500);
    // The generic error handler answers a safe envelope — the vendor never sees internals.
    expect(response.json().message).toBe('Internal server error.');
  });

  test('unknown event kind → 200 ignored with no marker claim', async () => {
    provider.webhook.parse = jest.fn<typeof provider.webhook.parse>().mockResolvedValue({
      kind: 'payment.something',
      paymentRef: 'ref',
      providerPaymentId: 'vendor-pay-1',
      operationId: 'op-1',
      rawStatus: {},
    });
    await buildApp();

    const response = await inject();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'ignored' });
    expect(ports.markerStore.claim).not.toHaveBeenCalled();
  });
});
