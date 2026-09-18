import type { CommercetoolsCartService } from '@commercetools/connect-payments-sdk';

/** The planned payment amount the SDK derives from a cart. */
export type PaymentAmount = Awaited<ReturnType<CommercetoolsCartService['getPaymentAmount']>>;
