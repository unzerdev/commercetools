import { ProviderError, type ProviderErrorItem } from '../../domain';

/**
 * One error item as Unzer shapes it. The vendor spells the operator text `merchantMessage`; a plain
 * `message` is read too, because the vendor uses it on some resources and dropping it would leave the
 * operator with the generic summary instead of the acquirer's own reason. The customer-facing text is
 * deliberately not read: it answers a different question and never reaches the merchant surface.
 */
interface UnzerErrorItem {
  code?: string | number | null;
  merchantMessage?: string | null;
  message?: string | null;
  customerMessage?: string | null;
  category?: string | null;
  propertyName?: string | null;
}

/** The raw non-2xx envelope. The vendor names the correlation id `id`; `errorId` is read as its twin. */
interface UnzerErrorBody {
  id?: string | null;
  errorId?: string | null;
  errors?: UnzerErrorItem[] | null;
}

/** Normalize the vendor envelope ONCE: the code as a string, the operator text as the reason, no raw leaf. */
function normalizeErrors(raw: unknown): { errorId?: string; items: ProviderErrorItem[] } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as UnzerErrorBody;
  const items = (Array.isArray(body.errors) ? body.errors : []).map((item) => {
    const message = item?.merchantMessage ?? item?.message;
    return {
      ...(item?.code != null ? { code: String(item.code) } : {}),
      ...(message ? { message } : {}),
      ...(item?.category ? { category: item.category } : {}),
      ...(item?.propertyName ? { propertyName: item.propertyName } : {}),
    };
  });
  const errorId = body.errorId ?? body.id;
  return { ...(errorId ? { errorId } : {}), items };
}

/**
 * The typed provider error: the only shape a vendor failure leaves `providers/psp` in. The raw vendor body
 * never escapes; `statusCode` is the status the transport observed and the sole input to the core's
 * release decision, so a status a vendor puts inside its own items is never read as one.
 */
export class PspError extends ProviderError {
  /** The normalized vendor items, the same list `providerErrorItems` exposes to the core. */
  readonly vendorErrors: ReadonlyArray<ProviderErrorItem>;

  /** The vendor error id for support correlation, when supplied. */
  readonly errorId?: string;

  constructor(
    message: string,
    statusCode: number,
    vendorErrors: ReadonlyArray<ProviderErrorItem> = [],
    errorId?: string,
  ) {
    super(message, statusCode, vendorErrors);
    this.name = 'PspError';
    this.vendorErrors = vendorErrors;
    this.errorId = errorId;
    Object.setPrototypeOf(this, PspError.prototype);
  }

  /** A vendor error response: the first item's own sentence is the operator-facing message. */
  static fromErrorResponse(status: number, rawBody: unknown): PspError {
    const { errorId, items } = normalizeErrors(rawBody);
    const summary = items[0]?.message ?? 'The payment provider refused the request.';
    return new PspError(summary, status, items, errorId);
  }

  /** A transport rejection (DNS, TLS, socket); the cause object never travels. */
  static fromTransport(cause: unknown): PspError {
    const reason = cause instanceof Error ? cause.message : 'transport error';
    return new PspError(`PSP request failed: ${reason}`, 502);
  }

  /** The vendor answered a shape the connector cannot read; `what` names the field so the log points at the drift. */
  static malformedResponse(what: string): PspError {
    return new PspError(`PSP response could not be read (${what})`, 502);
  }

  /** A call that outran its deadline: 504, ambiguous by design, never read as the vendor saying no. */
  static timedOut(timeoutMs: number): PspError {
    return new PspError(`PSP request timed out after ${timeoutMs}ms`, 504);
  }

  /** Whether the error carries the given vendor code. */
  hasVendorCode(code: string): boolean {
    return this.vendorErrors.some((item) => item.code === code);
  }
}
