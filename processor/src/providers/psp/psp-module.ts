import type { ProviderModule } from '../../application/handlers';
import { PspConfigHandler } from './config/config.handler';
import { PspCustomerHandler } from './customer/customer.handler';
import { PspIntrospectionService } from './introspection/introspection.service';
import { PspMethodSurface } from './introspection/method-surface';
import { pspMethodLogos } from './methods';
import { PspModificationHandler } from './modifications/modification.handler';
import { buildPspPaymentCustomType } from './payment-custom-type';
import { PspPaymentHandler } from './payment/payment.handler';
import { PSP_KEY } from './provider-key';
import { PspReturnHandler } from './return/return.handler';
import { mapProviderStatus } from './status';
import { PspWebhookHandler } from './webhook/webhook.handler';

/**
 * The Unzer provider's `ProviderModule` for the brand's custom-type key, threaded in because the provider ring
 * may not read `infrastructure/config`. Every handler is stateless against the resolved config, so one
 * instance of each is shared.
 */
export const buildPspModule = (typeKey: string): ProviderModule => ({
  key: PSP_KEY,
  paymentCustomType: buildPspPaymentCustomType(typeKey),
  methodLogos: pspMethodLogos,
  mapProviderStatus,
  config: new PspConfigHandler(),
  payment: new PspPaymentHandler(),
  modifications: new PspModificationHandler(),
  returnLeg: new PspReturnHandler(),
  introspection: new PspIntrospectionService(),
  surface: new PspMethodSurface(),
  customers: new PspCustomerHandler(),
  webhook: new PspWebhookHandler(),
});
