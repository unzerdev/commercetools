import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { FastifyError, type FastifyInstance } from 'fastify';
import { inspect } from 'node:util';
import { errorHandler } from '../src/infrastructure/bootstrap/libs/fastify/error-handler';
import { ErrorAuthErrorResponse, Errorx, ErrorxAdditionalOpts } from '@commercetools/connect-payments-sdk';
import { requestContextPlugin } from '../src/infrastructure/bootstrap/libs/fastify/context/context';
import { log } from '../src/infrastructure/bootstrap/libs/logger';
import { FastifySchemaValidationError } from 'fastify/types/schema';

describe('error-handler', () => {
  let fastify: FastifyInstance;
  beforeEach(async () => {
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(requestContextPlugin);
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('errox error', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        message: 'someMessage',
        httpErrorStatus: 404,
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [
        {
          code: 'ErrorCode',
          message: 'someMessage',
        },
      ],
    });
  });

  test('errox with fields', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        message: 'someMessage',
        httpErrorStatus: 404,
        fields: {
          test: 'field1',
        },
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [
        {
          code: 'ErrorCode',
          message: 'someMessage',
          test: 'field1',
        },
      ],
    });
  });

  test('general error', async () => {
    fastify.get('/', () => {
      throw new Error('some message goes here');
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'Internal server error.',
      statusCode: 500,
      errors: [
        {
          code: 'General',
          message: 'Internal server error.',
        },
      ],
    });
  });

  test('Fastify error with missing required field', async () => {
    const validationError: FastifySchemaValidationError = {
      keyword: 'required',
      instancePath: 'instancePath/domain/value',
      schemaPath: 'schemaPath/domain/value',
      params: {
        missingProperty: 'dummy-field',
      },
      message: 'fastify-error-message',
    };
    const fastifyError: FastifyError = {
      code: 'ErrorCode',
      name: 'fastify-error',
      message: 'fastify-error-message',
      validation: [validationError],
    };
    fastify.get('/', () => {
      throw fastifyError;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(response.json()).toStrictEqual({
      message: 'A value is required for field dummy-field.',
      statusCode: 400,
      errors: [
        {
          code: 'RequiredField',
          field: 'dummy-field',
          message: 'A value is required for field dummy-field.',
        },
      ],
    });
  });

  test('unhandled error on a webhook URL logs the token segment as <redacted>', async () => {
    // The root-cause log line interpolates `req.url`; on the capability-URL route the last path
    // segment is a bearer secret, so the logged URL must carry `<redacted>` in its place.
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => log);
    try {
      fastify.post('/webhooks/:storeKey/:token', () => {
        throw new Error('reconcile failed');
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/webhooks/store-x/some-token-value',
      });

      expect(response.statusCode).toBe(500);
      const [rootCauseMessage] = errorSpy.mock.calls[0];
      expect(rootCauseMessage).toContain('POST /webhooks/store-x/<redacted>: reconcile failed');
      // NO argument of ANY log.error call on this path carries the secret (inspect handles cycles).
      expect(inspect(errorSpy.mock.calls, { depth: 6 })).not.toContain('some-token-value');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('an unhandled error whose MESSAGE embeds a tokened webhook URL logs it <redacted>', async () => {
    // The connect flow's `registerWebhooks` propagates vendor errors that echo the registered
    // capability URL back; they reach logging only here, so the MESSAGE must be redacted too —
    // not just `req.url`.
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => log);
    try {
      fastify.get('/operations/store-config', () => {
        throw new Error('vendor rejected the subscription for https://proc.example/webhooks/store-x/secret-token-9');
      });

      const response = await fastify.inject({ method: 'GET', url: '/operations/store-config' });

      expect(response.statusCode).toBe(500);
      // The logger type exposes a single-argument overload; the runtime call carries (message, meta).
      const firstCall = errorSpy.mock.calls[0] as unknown[];
      expect(String(firstCall[0])).toContain('/webhooks/store-x/<redacted>');
      expect(String(firstCall[0])).not.toContain('secret-token-9');
      // The structured err fields (message + stack) are redacted as well.
      expect(inspect(firstCall[1], { depth: 6 })).not.toContain('secret-token-9');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('an Errorx whose message embeds a tokened webhook URL logs the message <redacted>', async () => {
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => log);
    try {
      fastify.get('/operations/store-config', () => {
        throw new Errorx({
          code: 'WebhookRegistrationFailed',
          message: 'registration refused for https://proc.example/webhooks/store-x/secret-token-9',
          httpErrorStatus: 400,
        });
      });

      const response = await fastify.inject({ method: 'GET', url: '/operations/store-config' });

      expect(response.statusCode).toBe(400);
      const loggedMessages = errorSpy.mock.calls.map(([message]) => message);
      expect(loggedMessages.some((message) => String(message).includes('/webhooks/store-x/<redacted>'))).toBe(true);
      // NOT just the message: the error travels as winston METADATA on the same call, and winston
      // serializes an Errorx's own `message`/`stack` into the record — so redacting the first
      // argument alone leaves the raw token one field away from the redacted copy. No argument of
      // any call may carry it (`inspect` walks the metadata object and handles cycles).
      for (const call of errorSpy.mock.calls) {
        expect(inspect(call, { depth: 6 })).not.toContain('secret-token-9');
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  // The leak this closes was NOT visible by reading: a provider error reaching the handler as a
  // `cause` serializes its own ENUMERABLE fields — the vendor's error items, which echo the URL the
  // connect flow registered — so redacting `message`/`stack` alone left the raw token one field
  // away. The metadata redaction is therefore deep, and this pins every carrier, however nested.
  test('a tokened URL nested in the cause chain and its vendor items never reaches a log record', async () => {
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => log);
    try {
      fastify.get('/operations/store-config', () => {
        const vendorFailure = Object.assign(new Error('vendor rejected the subscription'), {
          statusCode: 400,
          vendorErrors: [{ code: 'API.400.100', merchantMessage: 'duplicate for /webhooks/store-x/secret-token-9' }],
        });
        throw new Errorx({
          code: 'WebhookRegistrationFailed',
          message: 'registration refused',
          httpErrorStatus: 400,
          cause: vendorFailure,
        });
      });

      const response = await fastify.inject({ method: 'GET', url: '/operations/store-config' });

      expect(response.statusCode).toBe(400);
      for (const call of errorSpy.mock.calls) {
        const serialized = inspect(call, { depth: 10 });
        expect(serialized).not.toContain('secret-token-9');
      }
      // The surrounding text survives — redaction replaces the token segment, not the diagnosis.
      expect(inspect(errorSpy.mock.calls, { depth: 10 })).toContain('/webhooks/store-x/<redacted>');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('ErrorAuthErrorResponse', async () => {
    const opts: ErrorxAdditionalOpts = {
      privateFields: {},
      privateMessage: '',
      fields: {},
      skipLog: true,
      cause: undefined,
    };
    const authErrorResponse: ErrorAuthErrorResponse = new ErrorAuthErrorResponse('someMessage', opts, '401');

    fastify.get('/', () => {
      throw authErrorResponse;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 401,
      errors: [
        {
          code: '401',
          message: 'someMessage',
        },
      ],
      error: '401',
      error_description: 'someMessage',
    });
  });
});
