import type { OrderWithPayments } from './order-with-payments';

/** The connector's only Order read. */
export interface OrderReader {
  getWithPayments(orderId: string): Promise<OrderWithPayments>;
}
