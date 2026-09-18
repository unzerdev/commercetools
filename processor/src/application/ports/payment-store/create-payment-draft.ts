import type { CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';

/** The draft `createPayment` accepts. */
export type CreatePaymentDraft = Parameters<CommercetoolsPaymentService['createPayment']>[0];
