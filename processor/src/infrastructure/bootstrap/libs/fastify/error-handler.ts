import { FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';

import { FastifySchemaValidationError } from 'fastify/types/schema';
import { log } from '../logger';
import { redactErrorForLog, redactWebhookToken } from '../../../../domain';
import {
  ErrorAuthErrorResponse,
  ErrorGeneral,
  ErrorInvalidField,
  ErrorInvalidJsonInput,
  ErrorRequiredField,
  Errorx,
  MultiErrorx,
} from '@commercetools/connect-payments-sdk';
import { TAuthErrorResponse, TErrorObject, TErrorResponse } from './dtos/error.dto';

function isFastifyValidationError(error: Error): error is FastifyError {
  return (error as unknown as FastifyError).validation != undefined;
}

/** Maps every error onto the commercetools error response shape; an unknown error is logged with its root cause and answers 500. */
export const errorHandler = (error: Error, req: FastifyRequest, reply: FastifyReply) => {
  if (isFastifyValidationError(error) && error.validation) {
    return handleErrors(transformValidationErrors(error.validation, req), reply);
  } else if (error instanceof ErrorAuthErrorResponse) {
    return handleAuthError(error, reply);
  } else if (error instanceof Errorx) {
    return handleErrors([error], reply);
  } else if (error instanceof MultiErrorx) {
    return handleErrors(error.errors, reply);
  }

  log.error(`Unhandled error on ${req.method} ${redactWebhookToken(req.url)}: ${redactWebhookToken(error.message)}`, {
    err: {
      name: error.name,
      message: redactWebhookToken(error.message),
      stack: error.stack === undefined ? undefined : redactWebhookToken(error.stack),
    },
  });
  return handleErrors([new ErrorGeneral('Internal server error.', { cause: error, skipLog: false })], reply);
};

const handleAuthError = (error: ErrorAuthErrorResponse, reply: FastifyReply) => {
  const transformedErrors: TErrorObject[] = transformErrorxToHTTPModel([error]);

  const response: TAuthErrorResponse = {
    message: error.message,
    statusCode: error.httpErrorStatus,
    errors: transformedErrors,
    error: transformedErrors[0].code,
    error_description: transformedErrors[0].message,
  };

  return reply.code(error.httpErrorStatus).send(response);
};

const handleErrors = (errorxList: Errorx[], reply: FastifyReply) => {
  const transformedErrors: TErrorObject[] = transformErrorxToHTTPModel(errorxList);

  const response: TErrorResponse = {
    message: errorxList[0].message,
    statusCode: errorxList[0].httpErrorStatus,
    errors: transformedErrors,
  };

  return reply.code(errorxList[0].httpErrorStatus).send(response);
};

/** Every `Errorx` funnels through here: the logged message and metadata are deep token-redacted. */
const transformErrorxToHTTPModel = (errors: Errorx[]): TErrorObject[] => {
  const errorObjectList: TErrorObject[] = [];

  for (const err of errors) {
    const loggedMessage = redactWebhookToken(err.message);
    const loggedError = redactErrorForLog(err);
    if (err.skipLog) {
      log.debug(loggedMessage, loggedError);
    } else {
      log.error(loggedMessage, loggedError);
    }

    const tErrObj: TErrorObject = {
      code: err.code,
      message: err.message,
      ...(err.fields ? err.fields : {}),
    };

    errorObjectList.push(tErrObj);
  }

  return errorObjectList;
};

const transformValidationErrors = (errors: FastifySchemaValidationError[], req: FastifyRequest): Errorx[] => {
  const errorxList: Errorx[] = [];

  for (const err of errors) {
    switch (err.keyword) {
      case 'required':
        errorxList.push(new ErrorRequiredField(err.params.missingProperty as string));
        break;
      case 'enum':
        errorxList.push(
          new ErrorInvalidField(
            getKeys(err.instancePath).join('.'),
            String(getPropertyFromPath(err.instancePath, req.body) ?? ''),
            err.params.allowedValues as string,
          ),
        );
        break;
    }
  }

  if (errorxList.length === 0) {
    errorxList.push(new ErrorInvalidJsonInput());
  }

  return errorxList;
};

const getKeys = (path: string) => path.replace(/^\//, '').split('/');

/** The body value a validation error points at, or `undefined` when the path cannot be walked. */
const getPropertyFromPath = (path: string, obj: unknown): unknown => {
  let value: unknown = obj;
  for (const key of getKeys(path)) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};
