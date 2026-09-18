import type { Payment } from '@commercetools/connect-payments-sdk';
import { paymentSDK } from '../bootstrap/payment-sdk';

type PaymentUpdateAction = Parameters<
  ReturnType<ReturnType<typeof paymentSDK.ctAPI.client.payments>['withId']>['post']
>[0]['body']['actions'][number];

export type GetPaymentArgs = { id: string };
export type ApplyPaymentActionsArgs = { id: string; version: number; actions: PaymentUpdateAction[] };
export type QueryPaymentsArgs = {
  /** A commercetools predicate; values travel in `vars` as `var.<name>`, never string-built. */
  where: string;
  vars?: Record<string, string>;
  limit?: number;
};

async function get({ id }: GetPaymentArgs): Promise<Payment> {
  const { body } = await paymentSDK.ctAPI.client.payments().withId({ ID: id }).get().execute();
  return body as Payment;
}

/** Post update actions under the caller's version; a 409 propagates so the caller decides whether to retry. */
async function applyActions({ id, version, actions }: ApplyPaymentActionsArgs): Promise<Payment> {
  const { body } = await paymentSDK.ctAPI.client
    .payments()
    .withId({ ID: id })
    .post({ body: { version, actions } })
    .execute();
  return body as Payment;
}

async function query({ where, vars, limit }: QueryPaymentsArgs): Promise<Payment[]> {
  const { body } = await paymentSDK.ctAPI.client
    .payments()
    .get({ queryArgs: { where, ...(vars ?? {}), ...(limit !== undefined ? { limit } : {}) } })
    .execute();
  return body.results as Payment[];
}

export const payments = { get, applyActions, query };
