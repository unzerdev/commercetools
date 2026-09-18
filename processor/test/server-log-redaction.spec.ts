import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { requestContextPlugin } from '../src/infrastructure/bootstrap/libs/fastify/context/context';
import { log } from '../src/infrastructure/bootstrap/libs/logger';
import { redactErrorForLog, redactWebhookToken } from '../src/domain';
import { requestLogSerializers, setupFastify } from '../src/infrastructure/http/server/server';

/**
 * Request-log token redaction: the webhook capability URL carries a bearer secret as
 * its last path segment (`POST /webhooks/:storeKey/:token`), so the processor's own request logs
 * must never persist it. This suite mirrors the production logger wiring on a bare Fastify — the
 * same pino `serializers` object `setupFastify` passes to the `logger` option, pointed at a capture
 * stream — and asserts every emitted line shows the token segment as `<redacted>` while every
 * non-webhook URL logs verbatim.
 */
describe('request-log redaction of the webhook capability-URL token', () => {
  async function captureLogLines(method: 'GET' | 'POST', url: string): Promise<string[]> {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    // `level: 'info'` keeps Fastify's default request logging (the "incoming request" line with the
    // serialized `req.url`) enabled regardless of the ambient `loggerLevel` config.
    const fastify = Fastify({ logger: { level: 'info', stream, serializers: requestLogSerializers } });
    fastify.post('/webhooks/:storeKey/:token', async () => ({ outcome: 'processed' }));
    fastify.get('/operations/status', async () => ({ ok: true }));
    await fastify.inject({ method, url });
    await fastify.close();
    return lines;
  }

  test('a webhook request logs the token segment as <redacted> and never the real token', async () => {
    const lines = await captureLogLines('POST', '/webhooks/store-x/some-token-value');

    const urlLines = lines.filter((line) => line.includes('"url"'));
    expect(urlLines.length).toBeGreaterThan(0);
    expect(urlLines[0]).toContain('/webhooks/store-x/<redacted>');
    // NO line of ANY kind — incoming request, request completed, anything — carries the secret.
    for (const line of lines) {
      expect(line).not.toContain('some-token-value');
    }
  });

  test('a query string after the token survives redaction (only the path segment is a secret)', async () => {
    const lines = await captureLogLines('POST', '/webhooks/store-x/some-token-value?src=unzer');

    const urlLines = lines.filter((line) => line.includes('"url"'));
    expect(urlLines[0]).toContain('/webhooks/store-x/<redacted>?src=unzer');
    for (const line of lines) {
      expect(line).not.toContain('some-token-value');
    }
  });

  test('a non-webhook URL logs verbatim — the serializer never over-redacts', async () => {
    const lines = await captureLogLines('GET', '/operations/status');

    const urlLines = lines.filter((line) => line.includes('"url"'));
    expect(urlLines[0]).toContain('"url":"/operations/status"');
    for (const line of lines) {
      expect(line).not.toContain('<redacted>');
    }
  });

  // Overriding the `req` serializer replaces Fastify's default wholesale, so the FIELD SET is part of
  // the contract: renaming or dropping one silently breaks any log pipeline keyed on the defaults.
  // Fastify 5 emits exactly these six (`lib/logger-pino.js`), and `url` is the only value we alter.
  // A token can ride in places a value-only walk misses: as an object KEY, and behind a `toJSON`
  // that would make the serializer render the ORIGINAL object instead of the redacted copy.
  test('redactErrorForLog redacts keys and drops functions, so no carrier survives serialization', () => {
    const tokened = 'https://p.example/webhooks/store-a/SUPERSECRETTOKEN0000000000000000000000000';
    const redacted = redactErrorForLog({
      [tokened]: 'keyed by the URL',
      nested: { items: [{ merchantMessage: `duplicate for ${tokened}` }] },
      toJSON: () => ({ raw: tokened }),
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('SUPERSECRETTOKEN');
    expect(serialized).toContain('/webhooks/store-a/<redacted>');
    expect(Object.keys(redacted)).not.toContain('toJSON');
  });

  // The cycle guard tracks the ANCESTOR PATH, not every node ever visited. The post-deploy walk hands
  // this helper vendor errors in which one resolved store config is referenced from several branches of
  // the same graph — a shared node, not a back edge — and reporting the second reference as
  // `[Circular]` drops the diagnostic the operator needs from the only record of the failure.
  test('redactErrorForLog copies a shared non-cyclic sub-object at every reference', () => {
    const shared = { storeKey: 'store-a', webhookUrl: 'https://p.example/webhooks/store-a/TOKENTOKENTOKEN0000000000' };
    const redacted = redactErrorForLog({ first: shared, second: shared, list: [shared] }) as {
      first: unknown;
      second: unknown;
      list: unknown[];
    };

    const expected = { storeKey: 'store-a', webhookUrl: 'https://p.example/webhooks/store-a/<redacted>' };
    expect(redacted.first).toEqual(expected);
    expect(redacted.second).toEqual(expected);
    expect(redacted.list[0]).toEqual(expected);
  });

  // A genuine back edge still has to terminate, and it is the same `seen` set that decides both cases.
  test('redactErrorForLog still resolves a real cycle to [Circular]', () => {
    const cyclic: Record<string, unknown> = { storeKey: 'store-a' };
    cyclic.self = cyclic;

    expect(redactErrorForLog(cyclic)).toEqual({ storeKey: 'store-a', self: '[Circular]' });
  });

  // Fastify's DEFAULT 404 body quotes the request URL back — on the webhook route that URL carries
  // the capability token, and the caller is the vendor, whose delivery log the merchant reads. The
  // override in `setupFastify` is the control, so this exercises the REAL assembled server: a test
  // against a bare Fastify would pass on the leaky default and let the override be deleted unnoticed.
  test('an unmatched webhook URL 404s without echoing any part of the path', async () => {
    const server = await setupFastify();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/store-xyz/REAL-TOKEN-abcdefghijklmnopqrstuvwxyz012345678/extra',
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('REAL-TOKEN');
      expect(response.body).not.toContain('store-xyz');
      expect(response.body).not.toContain('/webhooks');
      expect(response.json()).toEqual({ message: 'Route POST not found', statusCode: 404 });
    } finally {
      await server.close();
    }
  });

  test('the serialized request keeps Fastify default field set — url is the only altered value', () => {
    const serialized = requestLogSerializers.req({
      method: 'POST',
      url: '/webhooks/store-x/some-token-value',
      headers: {},
      host: 'proc.example:8080',
      ip: '10.0.0.1',
      socket: { remotePort: 54321 },
    } as never);

    expect(Object.keys(serialized).sort()).toEqual(
      ['host', 'method', 'remoteAddress', 'remotePort', 'url', 'version'].sort(),
    );
    expect(serialized.host).toBe('proc.example:8080');
    expect(serialized.method).toBe('POST');
    expect(serialized.remoteAddress).toBe('10.0.0.1');
    expect(serialized.remotePort).toBe(54321);
    expect(serialized.url).toBe('/webhooks/store-x/<redacted>');
  });
});

/**
 * The APPLICATION logger's `path` formatter (`bootstrap/libs/logger`) rewrites every record's `path`
 * field with `getRequestContext().path` — the raw request URL. On the webhook route that URL carries
 * the bearer token, so the formatter must route it through `redactWebhookToken`: otherwise any
 * `log.*` call inside a webhook request persists the secret regardless of the pino serializer above.
 */
describe('application-log redaction of the webhook capability-URL token (the `path` formatter)', () => {
  test("a record's `path` field carries <redacted> inside a webhook request context", async () => {
    // The winston logger is a Transform stream whose readable side carries records AFTER the format
    // pipeline (the `path` rewrite included), so reading it asserts the formatter itself — no
    // dependency on which transport or console jest happens to install around the suite.
    const records: Record<string, unknown>[] = [];
    const collect = (record: Record<string, unknown>) => {
      records.push(record);
    };
    log.on('data', collect);
    try {
      const fastify = Fastify();
      await fastify.register(requestContextPlugin);
      fastify.post('/webhooks/:storeKey/:token', async () => {
        // Any meta `path` value is REWRITTEN by the formatter with the request-context path.
        log.info('webhook path formatter probe', { path: 'overwritten-by-formatter' });
        return { ok: true };
      });
      await fastify.inject({ method: 'POST', url: '/webhooks/store-x/some-token-value' });
      await fastify.close();
    } finally {
      log.off('data', collect);
    }

    const probes = records.filter((record) => String(record.message).includes('webhook path formatter probe'));
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[0].path).toBe('/webhooks/store-x/<redacted>');
    for (const record of probes) {
      expect(JSON.stringify(record)).not.toContain('some-token-value');
    }
  });
});

/**
 * The shared redaction helper itself: a log line often embeds the URL JSON-ESCAPED
 * (`\/webhooks\/…`) — a serialized error body quoted inside a message — and the escaped form must
 * redact exactly like the plain form, as defence in depth.
 */
describe('redactWebhookToken — escaped-embedding tolerance', () => {
  test('a JSON-escaped webhook URL embedding is redacted like the plain form', () => {
    expect(redactWebhookToken('body: {"url":"\\/webhooks\\/store-x\\/secret-token-value"}')).not.toContain(
      'secret-token-value',
    );
    expect(redactWebhookToken('\\/webhooks\\/store-x\\/secret-token-value')).toContain('<redacted>');
  });

  test('only the token segment is replaced — the text that follows it survives intact', () => {
    // The token is base64url by construction (`webhookUrlToken` digests base64url), so the match must
    // end at the first character outside that alphabet. A vendor error body echoing the registered URL
    // is the operator's only diagnostic of a STRANDED environment (`reregisterWebhooks`); redaction
    // must not consume the JSON terminator, the sibling fields, or trailing punctuation with it.
    expect(redactWebhookToken('{"url":"/webhooks/store-a/T","event":"all"}')).toBe(
      '{"url":"/webhooks/store-a/<redacted>","event":"all"}',
    );
    expect(redactWebhookToken('vendor rejected https://p.example/webhooks/store-a/AbC123token; retry later')).toBe(
      'vendor rejected https://p.example/webhooks/store-a/<redacted>; retry later',
    );
    expect(redactWebhookToken('see (https://p.example/webhooks/store-a/AbC123token) for details')).toBe(
      'see (https://p.example/webhooks/store-a/<redacted>) for details',
    );
  });

  test('the plain form still redacts and non-webhook text passes through verbatim', () => {
    expect(redactWebhookToken('POST /webhooks/store-x/secret-token-value failed')).toBe(
      'POST /webhooks/store-x/<redacted> failed',
    );
    expect(redactWebhookToken('GET /operations/status ok')).toBe('GET /operations/status ok');
  });
});
