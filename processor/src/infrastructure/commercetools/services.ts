import { paymentSDK } from '../bootstrap/payment-sdk';

/** The SDK service facades the adapters are constructed with. */
export const ctServices = {
  cart: paymentSDK.ctCartService,
  payment: paymentSDK.ctPaymentService,
  paymentMethod: paymentSDK.ctPaymentMethodService,
  customType: paymentSDK.ctCustomTypeService,
  authorization: paymentSDK.ctAuthorizationService,
};

/** The SDK authentication hooks the HTTP plugins mount as preHandlers. */
export const ctAuthHooks = {
  jwt: paymentSDK.jwtAuthHookFn,
  oauth2: paymentSDK.oauth2AuthHookFn,
  sessionHeader: paymentSDK.sessionHeaderAuthHookFn,
  authority: paymentSDK.authorityAuthorizationHookFn,
};
