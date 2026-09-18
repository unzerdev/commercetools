import type { PaymentResult, PayRequest, StoreConfig } from '../../../domain';

/** Pays with a browser-tokenized resource: charged or authorized, as the method's booking mode decides. */
export interface PaymentHandler {
  pay(cfg: StoreConfig, req: PayRequest): Promise<PaymentResult>;
}
