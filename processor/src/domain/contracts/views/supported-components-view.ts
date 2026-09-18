import type { PaymentComponent } from './supported-components';

/** The surfaces advertised by `GET /operations/payment-components`. */
export interface SupportedComponents {
  dropins: { type: string }[];
  components: PaymentComponent[];
  express: { type: string }[];
}
