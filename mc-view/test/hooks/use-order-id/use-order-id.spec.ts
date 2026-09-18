import { renderHook } from '@testing-library/react';
import { useCustomViewContext } from '@commercetools-frontend/application-shell-connectors';
import {
  orderIdFromHostUrl,
  useOrderId,
} from '../../../src/hooks/use-order-id';

/**
 * A Custom View gets no route params — the order it is embedded on is only knowable from `hostUrl`,
 * the Merchant Center page URL. Every processor call the panel makes names that id, so parsing it
 * wrong means serving another order's payments.
 */

jest.mock('@commercetools-frontend/application-shell-connectors', () => ({
  useCustomViewContext: jest.fn(),
}));

const useCustomViewContextMock = useCustomViewContext as jest.MockedFunction<
  typeof useCustomViewContext
>;

describe('orderIdFromHostUrl', () => {
  it.each([
    [
      'https://mc.europe-west1.gcp.commercetools.com/my-project/orders/f0b1c8de-1234-4d6b-8f47-6a0b1c8de111/payments',
      'f0b1c8de-1234-4d6b-8f47-6a0b1c8de111',
    ],
    [
      'https://mc.europe-west1.gcp.commercetools.com/my-project/orders/order-1/general',
      'order-1',
    ],
    ['https://mc.commercetools.com/my-project/orders/order-1', 'order-1'],
    [
      'https://mc.commercetools.com/my-project/orders/order-1/payments?tab=1#anchor',
      'order-1',
    ],
  ])('reads the order id out of %s', (hostUrl, expected) => {
    expect(orderIdFromHostUrl(hostUrl)).toBe(expected);
  });

  it.each([
    [
      'a host page that is not an order',
      'https://mc.commercetools.com/my-project/products/p-1',
    ],
    ['no host url at all', undefined],
  ])('yields no order id for %s', (_case, hostUrl) => {
    expect(orderIdFromHostUrl(hostUrl)).toBeUndefined();
  });
});

describe('useOrderId', () => {
  it('reads the order id from the custom-view context', () => {
    useCustomViewContextMock.mockImplementation((selector) =>
      selector({
        hostUrl:
          'https://mc.commercetools.com/my-project/orders/order-7/payments',
      } as never)
    );

    expect(renderHook(() => useOrderId()).result.current).toBe('order-7');
  });
});
