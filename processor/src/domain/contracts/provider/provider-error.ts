import type { ProviderErrorItem } from './provider-error-item';

/**
 * The typed failure a provider raises. Everything on it is safe to show an operator: the message is the
 * provider's sanitized summary, never a raw vendor body or a transport request.
 */
export abstract class ProviderError extends Error {
  /** The HTTP status the transport observed, or the vendor's own; the core's release decision reads it. */
  readonly statusCode: number;

  readonly providerErrorItems?: ReadonlyArray<ProviderErrorItem>;

  protected constructor(message: string, statusCode: number, providerErrorItems?: ReadonlyArray<ProviderErrorItem>) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    if (providerErrorItems && providerErrorItems.length > 0) {
      this.providerErrorItems = providerErrorItems;
    }
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}
