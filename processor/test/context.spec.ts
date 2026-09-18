/**
 * The request-context getters the connector actually reads: the cart id the session principal names, and
 * the checkout transaction item id the payment route threads onto the payment it creates. The SDK's
 * principal carries more than that, and a getter for a value nothing consumes is a surface with no reader.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { SessionAuthentication, SessionPrincipal } from '@commercetools/connect-payments-sdk';
import * as Context from '../src/infrastructure/bootstrap/libs/fastify/context/context';

describe('context', () => {
  const sessionId: string = '123456-123456-123456-123456';
  const principal: SessionPrincipal = {
    cartId: '123456',
    allowedPaymentMethods: [],
    processorUrl: 'http://127.0.0.1',
    paymentInterface: 'dummyPaymentInterface',
    merchantReturnUrl: 'https://merchant.return.url',
  };

  const mockSessionAuthentication: SessionAuthentication = new SessionAuthentication(sessionId, principal);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getCartIdFromContext reads the cart the session principal names', async () => {
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ authentication: mockSessionAuthentication });

    expect(Context.getCartIdFromContext()).toStrictEqual('123456');
  });

  test('getCheckoutTransactionItemIdFromContext is undefined when the context carries none', async () => {
    jest.spyOn(Context, 'getRequestContext').mockReturnValue({ authentication: mockSessionAuthentication });

    expect(Context.getCheckoutTransactionItemIdFromContext()).toBeUndefined();
  });
});
