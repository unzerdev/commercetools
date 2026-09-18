export type {
  CustomObjectRecord,
  FindCustomObjectArgs,
  QueryCustomObjectsArgs,
  RemoveCustomObjectArgs,
  SaveCustomObjectArgs,
} from './custom-objects';
export type { ApplyPaymentActionsArgs, GetPaymentArgs, QueryPaymentsArgs } from './payments';
export type { GetStoreArgs } from './stores';
export type { FindOrderArgs } from './orders';
export type { FindCustomerArgs } from './customers';
export type { PrunedFields } from './custom-types';
export type { StateOutcome } from './states';
export { ctAuthHooks, ctServices } from './services';
export { isConcurrentModification, isNotFound } from './errors';
export type { Execute } from './types';

import { customObjects } from './custom-objects';
import { customers } from './customers';
import { customTypes } from './custom-types';
import { orders } from './orders';
import { payments } from './payments';
import { states } from './states';
import { stores } from './stores';

/** The one commercetools client: one namespace per resource, the only place `paymentSDK` is reached from. */
export const ctClient = { customObjects, customers, customTypes, payments, states, stores, orders };
