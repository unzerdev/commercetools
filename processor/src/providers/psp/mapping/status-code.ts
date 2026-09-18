import type { ProviderStatusCode } from '../../../domain';
import { scrubDisplayString } from '../../../domain';
import type { UnzerMessage } from '../client';

/**
 * Unzer's own verdict message -> the display-only status code; `undefined` when the vendor stated no code.
 * The merchant-facing text is preferred; both are PAN-scrubbed vendor display lifts.
 */
export function toStatusCode(message: UnzerMessage | undefined): ProviderStatusCode | undefined {
  if (!message?.code) {
    return undefined;
  }
  const text = message.merchant ?? message.customer;
  return {
    code: scrubDisplayString(message.code),
    ...(text ? { text: scrubDisplayString(text) } : {}),
  };
}
