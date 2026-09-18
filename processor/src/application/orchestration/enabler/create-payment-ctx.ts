import type { PaymentRequest } from '../../../domain';
import type { OrchestrationCtx } from '../shared';

/** The shopper payload plus the request-scoped Checkout transaction-item id. */
export interface CreatePaymentCtx extends OrchestrationCtx {
  data: PaymentRequest;
  checkoutTransactionItemId?: string;
}
