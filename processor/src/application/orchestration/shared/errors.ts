import { ErrorGeneral, Errorx } from '@commercetools/connect-payments-sdk';
import { ProviderError, redactErrorForLog, redactWebhookToken } from '../../../domain';
import type { OrchestrationLogger } from './env';

/** The uniform, secret-free 403 for a resource that is not the connector's to serve. */
export function forbidden(message: string): Errorx {
  return new Errorx({ code: 'Forbidden', message, httpErrorStatus: 403, skipLog: true });
}

/** A vendor 401/403 is about the credentials we hold, not the caller, so it answers 400. */
const CALLER_VERDICT_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** A timeout or an idempotency conflict is a request the vendor may still be completing. */
const AMBIGUOUS_VENDOR_STATUSES: ReadonlySet<number> = new Set([408, 409]);

/**
 * Whether the vendor answered and refused: a definitive 4xx. Everything else may have moved the money, so
 * the caller must not release a reservation on it.
 */
export const vendorAnsweredAndRefused = (error: unknown): error is ProviderError =>
  error instanceof ProviderError &&
  error.statusCode >= 400 &&
  error.statusCode < 500 &&
  !AMBIGUOUS_VENDOR_STATUSES.has(error.statusCode);

/** The generic reason a shopper sees; the vendor's message is written for an operator. */
export const SHOPPER_PAYMENT_FAILURE_MESSAGE = 'The payment could not be completed.';

/**
 * Surface a provider failure without leaking a raw body: a refusal becomes a 4xx carrying the provider's
 * sanitized message (or `publicMessage` when the caller is a shopper), anything else a generic 500. The
 * typed error stays the `cause` for the reservation's release decision.
 */
export function wrapProviderError(
  error: unknown,
  operation: string,
  providerKey: string,
  logger: OrchestrationLogger,
  publicMessage?: string,
): Errorx {
  if (error instanceof Errorx) {
    return error;
  }

  if (vendorAnsweredAndRefused(error)) {
    logger.warn(`Provider operation '${operation}' was refused`, {
      error: redactWebhookToken(error.message),
      ...(error.providerErrorItems ? { providerErrors: redactErrorForLog(error.providerErrorItems) } : {}),
    });

    return new Errorx({
      code: 'ProviderRefusedOperation',
      message: publicMessage ?? error.message,
      httpErrorStatus: CALLER_VERDICT_STATUSES.has(error.statusCode) ? 400 : error.statusCode,
      cause: error,
      privateMessage: `Provider '${providerKey}' refused '${operation}' with ${error.statusCode}: ${error.message}`,
      skipLog: true,
    });
  }

  logger.error(`Provider operation '${operation}' failed`, {
    error: redactWebhookToken(error instanceof Error ? error.message : String(error)),
  });
  const vendorReason = error instanceof ProviderError ? error.message : 'Payment provider operation failed.';
  return new ErrorGeneral(publicMessage ?? vendorReason, {
    cause: error,
    privateMessage: `Provider '${providerKey}' failed during '${operation}': ${vendorReason}`,
  });
}
