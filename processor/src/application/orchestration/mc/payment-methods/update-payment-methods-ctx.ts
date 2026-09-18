import type { EnvironmentMode, PaymentMethodConfig } from '../../../../domain';
import type { OrchestrationCtx } from '../../shared';

/** The method list, an optional target store key, and the environment it is written for. */
export interface UpdatePaymentMethodsCtx extends OrchestrationCtx {
  body: { paymentMethods: PaymentMethodConfig[] };
  storeKey?: string;
  mode?: EnvironmentMode;
}
