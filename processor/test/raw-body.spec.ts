import { describe, expect, test } from '@jest/globals';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerRawBodyParser } from '../src/infrastructure/http/server/server';
import { registerWebhookRawBodyParser } from '../src/infrastructure/http/routes/vendor/webhook.route';

/**
 * The webhook route (`POST /webhooks/:storeKey/:token`) hands the provider's `parse` the EXACT bytes
 * the PSP sent. Fastify's default JSON parser consumes the stream and yields only the parsed object,
 * so the original bytes are lost. `registerRawBodyParser` installs an `application/json` buffer
 * parser that stashes the untouched Buffer on `request.rawBody` BEFORE parsing — so the webhook
 * handler interprets exactly what was delivered — while every other JSON route keeps receiving an
 * identical parsed `request.body`. These specs assert exactly that seam on a bare Fastify (no
 * full-server boot), mirroring `provider-routes.route.spec.ts`.
 */
describe('raw-body content-type parser (webhook raw-bytes seam)', () => {
  async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify();
    registerRawBodyParser(app);
    app.post('/echo', async (request) => {
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      return {
        isBuffer: Buffer.isBuffer(rawBody),
        raw: rawBody?.toString('utf8'),
        body: request.body,
      };
    });
    await app.ready();
    return app;
  }

  test('captures the exact request bytes on request.rawBody AND still parses the JSON body', async () => {
    const app = await buildApp();
    // Insignificant whitespace proves `rawBody` preserves the sent bytes, not a re-serialization:
    // the webhook receiver parses what the vendor actually sent, never a round-tripped copy.
    const payload = '{"eventId":"evt_1",  "type":"payment.captured"}';

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.isBuffer).toBe(true);
    expect(json.raw).toBe(payload); // byte-identical to what was sent
    expect(json.body).toEqual({ eventId: 'evt_1', type: 'payment.captured' }); // parsed body unaffected
    await app.close();
  });

  test('malformed JSON rejects with 400 (unchanged from Fastify default parser behavior)', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('empty JSON body rejects with 400 (unchanged from Fastify default parser behavior)', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

/**
 * The webhook receiver must capture the vendor's bytes whatever content type the delivery carries. The
 * reference integration reads the raw request stream and never consults the content type, and a vendor
 * that posts its JSON as `text/plain` (or with no type at all) is not a malformed delivery — it is a
 * delivery this receiver has to read. Capturing bytes only for `application/json` left every other type
 * with NO `rawBody`, which the route substituted with an empty buffer, which the provider's `parse` then
 * reported as unparseable JSON: a 500 the vendor retries forever over a body that was actually delivered.
 *
 * The catch-all parser is registered INSIDE the webhook plugin, so it is scoped to that route: no other
 * route starts accepting a body type it previously refused with a 415.
 */
describe('webhook raw-bytes capture across content types', () => {
  async function buildWebhookApp(): Promise<FastifyInstance> {
    const app = Fastify();
    // The server-wide `application/json` parser, exactly as the real bootstrap installs it.
    registerRawBodyParser(app);
    await app.register(async (scope) => {
      registerWebhookRawBodyParser(scope);
      scope.post('/webhooks/:storeKey/:token', async (request) => {
        const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
        return { captured: Buffer.isBuffer(rawBody), raw: rawBody?.toString('utf8') ?? null };
      });
    });
    app.post('/other', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  const payload = '{"event":"charge.succeeded","paymentId":"s-pay-1"}';

  test.each([
    ['application/json', 'the server-wide JSON parser'],
    ['application/json; charset=utf-8', 'a parametrized JSON type'],
    ['text/plain', 'a non-JSON type the vendor may still use'],
    ['application/x-www-form-urlencoded', 'a form-encoded delivery'],
    ['', 'a delivery carrying no content type at all'],
  ])('captures the exact bytes for %s (%s)', async (contentType) => {
    const app = await buildWebhookApp();

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/store-1/tok',
      ...(contentType ? { headers: { 'content-type': contentType } } : {}),
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ captured: true, raw: payload });
    await app.close();
  });

  // The catch-all is scoped to the webhook plugin: a sibling route must keep refusing a body type Fastify
  // has no parser for, so widening the receiver does not widen the whole API surface. `application/xml` is
  // the probe because Fastify ships built-in parsers for `application/json` and `text/plain` — neither was
  // ever a 415 — while it has none for XML.
  test('leaves routes outside the webhook scope refusing a content type Fastify cannot parse', async () => {
    const app = await buildWebhookApp();

    const res = await app.inject({
      method: 'POST',
      url: '/other',
      headers: { 'content-type': 'application/xml' },
      payload,
    });

    expect(res.statusCode).toBe(415);
    await app.close();
  });
});
