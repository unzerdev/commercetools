import type { WebhookHandler } from '../../../application/handlers';
import type { ProviderEvent, StoreConfig } from '../../../domain';
import { fractionDigitsForCurrency, fromDecimalAmount, PspClient, toPspConnectionConfig } from '../client';
import { toStatusCode } from '../mapping';
import { operationIdentity, unzerWebhookStatus } from '../status';
import { parseEnvelope, type UnzerWebhookEnvelope } from './envelope';
import { eventRule, settles, SUBSCRIBED_EVENTS, type UnzerEventRule } from './events';
import { operationLeg } from './legs';

/**
 * The webhook facade: bytes to envelope, envelope to the one rule registered under that exact event name, then
 * one authoritative payment read. Authenticity is the core's capability-token gate; beneath it the event body
 * is never the source of truth, only the fetched payment is.
 */
export class PspWebhookHandler implements WebhookHandler {
  constructor(private readonly unzer: Pick<PspClient, 'payments' | 'webhooks'> = new PspClient()) {}

  /**
   * Parse a delivery. An unsubscribed name, a body naming no payment, or unparseable bytes resolve to a bare
   * envelope without a vendor read: the reconciler ignores an unmapped kind, and a read for such an event
   * could only throw and put the vendor into indefinite redelivery.
   */
  async parse(rawBody: Buffer, cfg: StoreConfig): Promise<ProviderEvent> {
    const envelope = parseEnvelope(rawBody);
    const rawEvent = envelope.event ?? '';
    const rule = eventRule(rawEvent);
    const { paymentId } = envelope;

    if (rule === undefined || !paymentId) {
      return { kind: rawEvent, paymentRef: '', providerPaymentId: '', operationId: '', rawStatus: { state: '' } };
    }

    return this.settlement(rule, { ...envelope, paymentId }, cfg);
  }

  /** Exactly the events this connector settles; one subscription per name, all at the store's URL. */
  async registerWebhooks(cfg: StoreConfig, eventUrl: string): Promise<string[]> {
    return this.unzer.webhooks.register(toPspConnectionConfig(cfg), { url: eventUrl, events: SUBSCRIBED_EVENTS });
  }

  /** By ids when known; the account-wide delete only for a connection saved before ids were recorded. */
  async deleteWebhooks(cfg: StoreConfig, ids?: string[]): Promise<void> {
    await this.unzer.webhooks.delete(toPspConnectionConfig(cfg), { ids });
  }

  /**
   * Read the authoritative payment and normalize the event. `orderId` (the CT Payment id stamped at charge)
   * is the reconciliation anchor that survives, since the payment resource echoes no merchant reference.
   */
  private async settlement(
    rule: UnzerEventRule,
    envelope: UnzerWebhookEnvelope & { paymentId: string },
    cfg: StoreConfig,
  ): Promise<ProviderEvent> {
    const payment = await this.unzer.payments.get(toPspConnectionConfig(cfg), envelope.paymentId);
    const currency = payment.currency;
    const fractionDigits = fractionDigitsForCurrency(currency);
    const leg = operationLeg(payment, (candidate) => settles(rule, candidate), envelope.retrieveUrl);
    const statusCode = toStatusCode(leg?.message) ?? toStatusCode(payment.message);

    return {
      kind: rule.kind,
      paymentRef: payment.paymentReference ?? '',
      ...(payment.orderId ? { platformPaymentId: payment.orderId } : {}),
      providerPaymentId: payment.id || envelope.paymentId,
      operationId: leg ? operationIdentity(leg.url) : '',
      amount: fromDecimalAmount(leg?.amount, currency, fractionDigits),
      totalAmount: fromDecimalAmount(payment.amount?.total, currency, fractionDigits),
      acquiredAmount: fromDecimalAmount(payment.amount?.charged, currency, fractionDigits),
      cancelledAmount: fromDecimalAmount(payment.amount?.canceled, currency, fractionDigits),
      rawStatus: { state: unzerWebhookStatus(rule.kind, payment, leg) },
      ...(statusCode ? { statusCode } : {}),
    };
  }
}
