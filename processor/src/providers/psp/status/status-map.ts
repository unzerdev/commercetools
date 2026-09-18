import { PaymentState, type ProviderStatusInput } from '../../../domain';
import { PspError } from '../errors';
import type { PspStatusInput } from './psp-status-input';

const KNOWN_STATES: ReadonlySet<string> = new Set<string>(Object.values(PaymentState));

/** The provider's status envelope from an interpreted state. */
export function toRawStatus(state: PaymentState): PspStatusInput {
  return { state };
}

/** Validate the opaque envelope onto a `PaymentState`; an envelope naming no known state fails loudly. */
export function mapProviderStatus(raw: ProviderStatusInput): PaymentState {
  const state = (raw as Partial<PspStatusInput>).state;
  if (typeof state !== 'string' || !KNOWN_STATES.has(state)) {
    throw new PspError(`Unmapped PSP status: '${String(state)}'`, 500);
  }
  return state as PaymentState;
}
