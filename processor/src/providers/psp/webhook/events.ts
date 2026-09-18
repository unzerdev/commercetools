import type { SettlementKind } from '../../../domain';
import type { UnzerTransaction } from '../client';
import { legKind, type UnzerLegKind } from '../status';

/** One subscribed Unzer event: its exact name, the settlement kind the core reads, and the leg kind it may settle. */
export interface UnzerEventRule {
  event: string;
  kind: SettlementKind;
  settlesLeg: UnzerLegKind;
}

/**
 * The registry: the single source of both the dispatch table and the `eventList` the connection subscribes,
 * so an event cannot be listened to without a rule or handled without a subscription. What a settlement did
 * is read from the leg on the fetched payment, never from the event name.
 */
export const UNZER_EVENT_RULES: readonly UnzerEventRule[] = [
  { event: 'authorize.succeeded', kind: 'payment.pending_capture', settlesLeg: 'authorization' },
  { event: 'authorize.failed', kind: 'payment.pending_capture', settlesLeg: 'authorization' },
  { event: 'authorize.canceled', kind: 'payment.cancelled', settlesLeg: 'void' },
  { event: 'charge.succeeded', kind: 'payment.captured', settlesLeg: 'charge' },
  { event: 'charge.failed', kind: 'payment.captured', settlesLeg: 'charge' },
  { event: 'charge.canceled', kind: 'payment.refunded', settlesLeg: 'refund' },
  { event: 'chargeback', kind: 'payment.chargeback', settlesLeg: 'chargeback' },
];

/** The exact event names to subscribe, read off the registry. */
export const SUBSCRIBED_EVENTS: readonly string[] = UNZER_EVENT_RULES.map((rule) => rule.event);

/** The rule for a delivered event name, or `undefined` for one never subscribed. */
export function eventRule(event: string | undefined): UnzerEventRule | undefined {
  return UNZER_EVENT_RULES.find((rule) => rule.event === event);
}

/** Whether a rule may settle this leg. */
export function settles(rule: UnzerEventRule, leg: UnzerTransaction): boolean {
  return legKind(leg) === rule.settlesLeg;
}
