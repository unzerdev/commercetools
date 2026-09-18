import type { ReturnHandler } from '../../../application/handlers';
import type { ReturnContext, ReturnResolveRequest, ReturnResolveResult, StoreConfig } from '../../../domain';
import { readStringField } from '../../../domain';
import { PspClient, toPspConnectionConfig } from '../client';
import type { UnzerPayment, UnzerTransaction } from '../client';
import { PspError } from '../errors';
import { PSP_PAYMENT_ID_FIELD, PSP_SHOPPER_RETURN_URL_FIELD, timingSafeEquals, toStatusCode } from '../mapping';
import { legKind, operationIdentity, toRawStatus, unzerPaymentStatus } from '../status';

/** The newest authorization or charge leg by the vendor's own date; the operation the return concludes. */
function newestSettlingLeg(payment: UnzerPayment): UnzerTransaction | undefined {
  return (payment.transactions ?? [])
    .filter((leg) => legKind(leg) === 'authorization' || legKind(leg) === 'charge')
    .reduce<UnzerTransaction | undefined>((newest, leg) => {
      if (newest === undefined) {
        return leg;
      }
      return (leg.date ?? '') >= (newest.date ?? '') ? leg : newest;
    }, undefined);
}

/**
 * The return leg. Unzer appends no signed parameter, so the return is authenticated structurally: the payment
 * id comes only from the server-stamped custom field, and the authoritative read must be that same payment.
 */
export class PspReturnHandler implements ReturnHandler {
  constructor(private readonly unzer: Pick<PspClient, 'payments'> = new PspClient()) {}

  /** The stamped payment id and the shopper's storefront return URL, off the CT Payment's custom fields. */
  readContext(fields: Record<string, unknown>): ReturnContext {
    const providerContext: Record<string, string> = {};
    const paymentId = readStringField(fields, PSP_PAYMENT_ID_FIELD);
    if (paymentId) {
      providerContext[PSP_PAYMENT_ID_FIELD] = paymentId;
    }
    const shopperReturnUrl = readStringField(fields, PSP_SHOPPER_RETURN_URL_FIELD);
    return {
      ...(shopperReturnUrl ? { shopperReturnUrl } : {}),
      providerContext,
    };
  }

  /** Fail closed without a stamped id, read the payment once, refuse a body naming another payment, reflect its state. */
  async resolve(cfg: StoreConfig, { context }: ReturnResolveRequest): Promise<ReturnResolveResult> {
    const stampedPaymentId = context[PSP_PAYMENT_ID_FIELD];
    if (!stampedPaymentId) {
      throw new PspError('Return authenticity failed: no stamped payment reference', 403);
    }

    const payment = await this.unzer.payments.get(toPspConnectionConfig(cfg), stampedPaymentId);

    if (!timingSafeEquals(stampedPaymentId, payment.id)) {
      throw new PspError('Return authenticity failed: authoritative payment mismatch', 403);
    }

    const statusCode = toStatusCode(payment.message);
    const settling = newestSettlingLeg(payment);

    return {
      providerPaymentId: payment.id,
      ...(settling ? { providerOperationId: operationIdentity(settling.url) } : {}),
      rawStatus: toRawStatus(unzerPaymentStatus(payment)),
      ...(statusCode ? { statusCode } : {}),
      action: { kind: 'none' },
    };
  }
}
