import type { PaymentMethodsEnvironment } from './payment-methods-environment';

/**
 * The persisted payment-methods Custom Object value: the merchant's own method configuration, one list
 * per environment, because a store's two Unzer accounts serve different method sets.
 */
export interface PaymentMethodsObject {
  store: string;
  environments: {
    sandbox?: PaymentMethodsEnvironment;
    live?: PaymentMethodsEnvironment;
  };
}
