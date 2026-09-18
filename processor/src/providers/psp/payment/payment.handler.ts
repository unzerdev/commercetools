import type { PaymentHandler } from '../../../application/handlers';
import type { PaymentResult, PayRequest, StoreConfig } from '../../../domain';
import { PspClient, toPspConnectionConfig } from '../client';
import type { PspConnectionConfig, UnzerPaymentInput } from '../client';
import { PspCustomerHandler } from '../customer/customer.handler';
import { PspError } from '../errors';
import {
  pspCustomFields,
  redirectAction,
  toStatusCode,
  toUnzerBasket,
  toUnzerMetadata,
  transferInstructions,
} from '../mapping';
import { resolveBookingMode, showsTransferInstructions } from '../methods';
import { toRawStatus, unzerPaymentStatus } from '../status';
import { TtlMemo } from '../ttl-memo';

/** The metadata memo window; bounds how long a rotated keypair keeps addressing the old account's resource. */
const METADATA_TTL_MS = 120_000;

/**
 * The provider payment concern: charge or authorize the browser-tokenized type id, per the method's booking
 * mode. The customer, the basket and the integration metadata are resolved first and travel as ids, so a
 * failure among them refuses the payment with nothing to unwind.
 */
export class PspPaymentHandler implements PaymentHandler {
  /** The vendor metadata resource id per `(storeKey, mode)`; its body is deployment-constant. */
  private readonly metadataMemo = new TtlMemo<string>(METADATA_TTL_MS);

  constructor(
    private readonly unzer: Pick<PspClient, 'payments' | 'baskets'> = new PspClient(),
    private readonly customers: Pick<PspCustomerHandler, 'resolveCustomerId'> = new PspCustomerHandler(),
  ) {}

  /**
   * Pay: the vendor authorize endpoint when the method books as `authorize`, else charge. A redirect method
   * answers with a redirect target, prepayment with the transfer instructions the checkout must show.
   */
  async pay(cfg: StoreConfig, req: PayRequest): Promise<PaymentResult> {
    const connection = toPspConnectionConfig(cfg);

    const input: UnzerPaymentInput = {
      resourceId: req.resourceId,
      amount: req.amount,
      fractionDigits: req.fractionDigits,
      returnUrl: req.returnUrl,
      orderId: req.orderId,
      paymentReference: req.paymentRef,
      ...(await this.linkedResources(connection, cfg, req)),
      ...(req.deviceFingerprintId ? { threatMetrixId: req.deviceFingerprintId } : {}),
    };

    const bookingMode = resolveBookingMode(req.paymentMethodCode, req.bookingMode);
    const unzer =
      bookingMode === 'authorize'
        ? await this.unzer.payments.authorize(connection, input)
        : await this.unzer.payments.charge(connection, input);
    const statusCode = toStatusCode(unzer.message);
    const providerPaymentId = unzer.resources?.paymentId;
    if (!providerPaymentId) {
      throw new PspError('PSP charge response carried no payment id', 502);
    }
    const instructions = showsTransferInstructions(req.paymentMethodCode)
      ? transferInstructions(unzer.processing)
      : undefined;
    const action = unzer.redirectUrl ? redirectAction(unzer.redirectUrl) : (instructions ?? { kind: 'none' });
    return {
      providerPaymentId,
      ...(unzer.id ? { providerOperationId: unzer.id } : {}),
      bookingMode,
      action,
      rawStatus: toRawStatus(unzerPaymentStatus(unzer, bookingMode)),
      ...(statusCode ? { statusCode } : {}),
      customFields: pspCustomFields(
        {
          paymentId: providerPaymentId,
          merchantReference: req.paymentRef,
          ...(req.shopperReturnUrl ? { shopperReturnUrl: req.shopperReturnUrl } : {}),
        },
        cfg.paymentTypeKey,
      ),
    };
  }

  /** The customer, metadata and (when lines were passed) basket resources the charge links by id. */
  private async linkedResources(
    connection: PspConnectionConfig,
    cfg: StoreConfig,
    req: PayRequest,
  ): Promise<Pick<UnzerPaymentInput, 'customerId' | 'basketId' | 'metadataId'>> {
    const customerId = await this.customers.resolveCustomerId(connection, {
      ...(req.shopperRef ? { shopperRef: req.shopperRef } : {}),
      ...(req.shopper ? { shopper: req.shopper } : {}),
      ...(req.billingAddress ? { billingAddress: req.billingAddress } : {}),
      ...(req.shippingAddress ? { shippingAddress: req.shippingAddress } : {}),
      ...(req.locale ? { locale: req.locale } : {}),
      ...(req.candidateCustomerId ? { candidateCustomerId: req.candidateCustomerId } : {}),
    });

    const metadataId = await this.resolveMetadataId(connection, cfg);

    const basketId = req.basket
      ? await this.unzer.baskets.create(
          connection,
          toUnzerBasket(req.basket, req.amount.centAmount, req.amount.currencyCode, req.fractionDigits, req.orderId),
        )
      : undefined;

    return {
      ...(customerId ? { customerId } : {}),
      ...(basketId ? { basketId } : {}),
      ...(metadataId ? { metadataId } : {}),
    };
  }

  /** The metadata resource id for this store-environment; a miss creates it once and caches only a success. */
  private async resolveMetadataId(connection: PspConnectionConfig, cfg: StoreConfig): Promise<string | undefined> {
    const key = `${cfg.storeKey}:${cfg.mode}`;
    const cached = this.metadataMemo.get(key);
    if (cached) {
      return cached;
    }
    const id = await this.unzer.baskets.createMetadata(connection, toUnzerMetadata(cfg));
    if (id) {
      this.metadataMemo.set(key, id);
    }
    return id;
  }
}
