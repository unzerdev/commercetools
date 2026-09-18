import { PspError } from '../../errors';

/**
 * A transaction leg on a payment. The leg's own id is the trailing segment of `url`; `amount` is the decimal
 * wire amount; `status` is the leg's own outcome (`success` | `pending` | `error`).
 */
export interface UnzerTransaction {
  type?: string;
  url?: string;
  date?: string;
  amount?: string;
  status?: string;
  message?: UnzerMessage;
}

/** Unzer's own verdict message: the code an operator quotes to support plus merchant and customer texts; display only. */
export interface UnzerMessage {
  code?: string;
  merchant?: string;
  customer?: string;
}

/**
 * The payment resource subset the connector reads. `GET /v1/payments/{id}` returns the payment (coarse `state`
 * plus `transactions`); a charge or authorize returns the transaction it created (the `isSuccess` /
 * `isPending` / `isError` triple, no `state`, the payment id under `resources.paymentId`).
 */
export interface UnzerPayment {
  id: string;
  state?: { id?: number; name?: string };
  isSuccess?: boolean;
  isPending?: boolean;
  isError?: boolean;
  /** The `orderId` the connector stamped at charge time (the CT payment id), echoed back. */
  orderId?: string;
  /** The merchant reference stamped at charge time, echoed on the payment resource. */
  paymentReference?: string;
  currency?: string;
  /** The cumulative amount book as decimal strings. */
  amount?: { total?: string; charged?: string; canceled?: string; remaining?: string };
  resources?: { paymentId?: string; typeId?: string; basketId?: string; customerId?: string };
  transactions?: UnzerTransaction[];
  redirectUrl?: string;
  message?: UnzerMessage;
  processing?: Record<string, unknown>;
}

/** The resource a modification answers with: its own id is the operation id, the triple is the synchronous verdict. */
export interface UnzerModification {
  id: string;
  isSuccess?: boolean;
  isPending?: boolean;
  isError?: boolean;
  amount?: string;
  message?: UnzerMessage;
}

/** The `id` of a just-created resource; a 2xx without one fails closed. */
export function createdResourceId(body: unknown, resource: string): string {
  const id = (body as { id?: string } | undefined)?.id;
  if (!id) {
    throw new PspError(`PSP ${resource} response carried no id`, 502);
  }
  return id;
}
