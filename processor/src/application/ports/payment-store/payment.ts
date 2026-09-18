import type { CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';

/** The commercetools Payment as the SDK returns it. */
export type Payment = Awaited<ReturnType<CommercetoolsPaymentService['getPayment']>>;
