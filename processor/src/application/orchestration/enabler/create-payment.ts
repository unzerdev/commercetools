import { ErrorGeneral, ErrorInvalidOperation, Errorx } from '@commercetools/connect-payments-sdk';
import type { Money, PaymentInitiationResult, PaymentMethodConfig, PaymentResult, StoreConfig } from '../../../domain';
import {
  mintMerchantReference,
  openedOperationEffect,
  PAYMENT_STORE_KEY_FIELD,
  PAYMENT_SURCHARGE_FIELD,
} from '../../../domain';
import type { Payment } from '../../ports';
import {
  assertAllowedReturnUrl,
  buildBasketLines,
  buildCartEnrichment,
  buildProcessorReturnUrl,
  cartCountry,
  effectiveMethods,
  mergeShopper,
  type OrchestrationDeps,
  type OrchestrationEnv,
  recordPaymentOutcome,
  resolveShopperConfig,
  resolveSurcharge,
  SHOPPER_PAYMENT_FAILURE_MESSAGE,
  wrapProviderError,
} from '../shared';
import type { CreatePaymentCtx } from './create-payment-ctx';

/** The chosen method's config from the same effective list the shopper was offered; a disabled code is refused before anything is created. */
async function resolveMethodConfig(
  cfg: StoreConfig,
  code: string,
  deps: OrchestrationDeps,
): Promise<PaymentMethodConfig> {
  const stored = await deps.ports.paymentMethodsStore.readEffective(cfg.storeKey, cfg.inheritsDefaultScope);
  const configured = effectiveMethods(stored, cfg.mode).find((m) => m.paymentMethodCode === code);
  if (!configured?.enabled) {
    throw new ErrorInvalidOperation(`Payment method '${code}' is not enabled for this store.`);
  }
  return configured;
}

/**
 * Reflect a successful pay onto the CT Payment. Fenced apart from the pay call: the shopper's money has
 * moved, so a failure here logs the reconciliation triple and is named for what broke.
 *
 * An operation the vendor accepted but has not settled (a redirect ahead, a transfer awaited) is recorded as a
 * `Pending` leg of the booked kind, keyed on the vendor's operation id: a host that verifies the payment right
 * after this call finds the opened operation, and the return leg or the webhook later moves that same leg.
 */
async function recordPayInCommercetools(
  payment: Payment,
  result: PaymentResult,
  cfg: StoreConfig,
  surcharge: number,
  merchantReference: string,
  env: OrchestrationEnv,
  deps: OrchestrationDeps,
): Promise<void> {
  try {
    const state = deps.provider.mapProviderStatus(result.rawStatus);
    const effect = openedOperationEffect(state, result.bookingMode);
    await recordPaymentOutcome(
      payment,
      {
        effect,
        state,
        statusCode: result.statusCode,
        amount: payment.amountPlanned,
        interactionId: result.providerOperationId ?? result.providerPaymentId,
        pspReference: result.providerPaymentId,
        customFields: {
          type: { key: result.customFields?.typeKey ?? cfg.paymentTypeKey, typeId: 'type' },
          fields: {
            ...(result.customFields?.fields ?? {}),
            [PAYMENT_STORE_KEY_FIELD]: cfg.storeKey,
            [PAYMENT_SURCHARGE_FIELD]: String(surcharge),
          },
        },
      },
      env,
      deps.ports,
    );
  } catch (error) {
    env.logger.error('The provider charged, but recording the charge in commercetools failed', {
      ctPaymentId: payment.id,
      providerPaymentId: result.providerPaymentId,
      merchantReference,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Errorx) {
      throw error;
    }
    throw new ErrorGeneral(SHOPPER_PAYMENT_FAILURE_MESSAGE, {
      cause: error,
      privateMessage: `commercetools write failed after provider '${deps.provider.key}' charged payment '${payment.id}'.`,
    });
  }
}

/**
 * The tokenized resource is the only thing a payment can be booked against, so a request without one is
 * refused at intake - before a CT Payment exists and before the vendor is called. The wire schema requires
 * it too; this is the guard for every other caller of the orchestrator.
 */
function assertResourceRef(resourceId: string | undefined): void {
  if (!resourceId) {
    throw new ErrorInvalidOperation('A payment must carry a resourceId: the tokenized instrument to charge.');
  }
}

/**
 * `POST /payments`: validate the return URL, resolve the cart's store and the chosen method, create and
 * associate the CT Payment, pay the tokenized resource through the provider and record the outcome.
 */
export async function createPayment(ctx: CreatePaymentCtx, deps: OrchestrationDeps): Promise<PaymentInitiationResult> {
  const { env, data } = ctx;
  const { ports, provider } = deps;

  assertAllowedReturnUrl(data.returnUrl, env);
  assertResourceRef(data.resourceId);

  const ctCart = await ports.cartReader.getCart(ports.cartReader.currentCartId());
  const cfg = await resolveShopperConfig(ctCart, ports.configResolver);
  const method = await resolveMethodConfig(cfg, data.paymentMethodCode, deps);

  const cartAmount = await ports.cartReader.getPaymentAmount(ctCart);
  const surcharge = resolveSurcharge(method, cartAmount.currencyCode);
  const amountPlanned = { ...cartAmount, centAmount: cartAmount.centAmount + surcharge };
  const chargeAmount: Money = { centAmount: amountPlanned.centAmount, currencyCode: amountPlanned.currencyCode };

  const ctPayment = await ports.paymentStore.create({
    amountPlanned,
    paymentMethodInfo: {
      paymentInterface: env.brand.paymentInterface,
      method: method.paymentMethodCode,
      ...(Object.keys(method.name).length > 0 ? { name: method.name } : {}),
    },
    ...(ctx.checkoutTransactionItemId ? { checkoutTransactionItemId: ctx.checkoutTransactionItemId } : {}),
    ...(ctCart.customerId
      ? { customer: { typeId: 'customer', id: ctCart.customerId } }
      : ctCart.anonymousId
        ? { anonymousId: ctCart.anonymousId }
        : {}),
  });

  await ports.cartReader.addPayment({ id: ctCart.id, version: ctCart.version }, ctPayment.id);

  const merchantReference = mintMerchantReference(env.brand.paymentInterface, ctPayment.id);
  const processorReturnUrl = buildProcessorReturnUrl(ctPayment.id, env);
  const countryCode = cartCountry(ctCart);
  const {
    shopper: cartShopper,
    billingAddress: cartBilling,
    shippingAddress: cartShipping,
  } = buildCartEnrichment(ctCart);
  const collected = data.collectedCustomer;
  const dateOfBirth =
    collected?.dateOfBirth ??
    (ctCart.customerId ? await ports.customerReader.dateOfBirth(ctCart.customerId) : undefined);
  const shopper = mergeShopper(cartShopper, collected, dateOfBirth);
  const billingAddress = cartBilling ?? collected?.billingAddress;
  const shippingAddress = cartShipping ?? collected?.shippingAddress;

  let result: PaymentResult;
  try {
    result = await provider.payment.pay(cfg, {
      resourceId: data.resourceId,
      paymentMethodCode: method.paymentMethodCode,
      amount: chargeAmount,
      fractionDigits: amountPlanned.fractionDigits,
      paymentRef: merchantReference,
      returnUrl: processorReturnUrl ?? data.returnUrl,
      shopperReturnUrl: data.returnUrl,
      orderId: ctPayment.id,
      ...(method.bookingMode ? { bookingMode: method.bookingMode } : {}),
      ...(method.sendBasketData ? { basket: buildBasketLines(ctCart, chargeAmount.centAmount, surcharge) } : {}),
      ...(ctCart.customerId ? { shopperRef: ctCart.customerId } : {}),
      ...(Object.keys(shopper).length > 0 ? { shopper } : {}),
      ...(billingAddress ? { billingAddress } : {}),
      ...(shippingAddress ? { shippingAddress } : {}),
      ...(data.locale ? { locale: data.locale } : {}),
      ...(data.vendorCustomerId ? { candidateCustomerId: data.vendorCustomerId } : {}),
      ...(data.deviceFingerprintId ? { deviceFingerprintId: data.deviceFingerprintId } : {}),
      ...(countryCode ? { countryCode } : {}),
    });
  } catch (e) {
    throw wrapProviderError(e, 'createPayment', provider.key, env.logger, SHOPPER_PAYMENT_FAILURE_MESSAGE);
  }

  await recordPayInCommercetools(ctPayment, result, cfg, surcharge, merchantReference, env, deps);

  return { paymentReference: ctPayment.id, action: result.action };
}
