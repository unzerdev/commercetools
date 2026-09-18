import { Address, Cart, CustomLineItem, LineItem, ShippingInfo } from '@commercetools/connect-payments-sdk';
import { randomUUID } from 'crypto';

export const mockGetCartResult = () => {
  const cartId = randomUUID();
  const mockGetCartResult = {
    id: cartId,
    version: 1,
    customerEmail: 'shopper@example.test',
    locale: 'en-GB',
    lineItems: [lineItem],
    customLineItems: [customLineItem],
    totalPrice: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 150000,
      fractionDigits: 2,
    },
    billingAddress,
    shippingAddress,
    cartState: 'Ordered',
    origin: 'Customer',
    taxMode: 'ExternalAmount',
    taxRoundingMode: 'HalfEven',
    taxCalculationMode: 'LineItemLevel',
    shipping: [],
    discountCodes: [],
    directDiscounts: [],
    refusedGifts: [],
    itemShippingAddresses: [],
    inventoryMode: 'ReserveOnOrder',
    shippingMode: 'Single',
    shippingInfo: shippingInfo,
    createdAt: '2024-01-01T00:00:00Z',
    lastModifiedAt: '2024-01-01T00:00:00Z',
  } as unknown as Cart;
  return mockGetCartResult;
};

const billingAddress: Address = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  streetName: 'Baker Street',
  streetNumber: '221B',
  postalCode: 'NW1 6XE',
  city: 'London',
  state: 'Greater London',
  country: 'GB',
};

const shippingAddress: Address = {
  firstName: 'Grace',
  lastName: 'Hopper',
  streetName: 'Navy Yard',
  streetNumber: '1',
  postalCode: '20374',
  city: 'Washington',
  state: 'DC',
  country: 'US',
};

const lineItem: LineItem = {
  id: 'lineitem-id-1',
  productId: 'product-id-1',
  name: {
    en: 'lineitem-name-1',
  },
  productType: {
    id: 'product-type-reference-1',
    typeId: 'product-type',
  },
  price: {
    id: 'price-id-1',
    value: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 150000,
      fractionDigits: 2,
    },
  },
  quantity: 1,
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  discountedPricePerQuantity: [],
  taxedPricePortions: [],
  state: [],
  perMethodTaxRate: [],
  priceMode: 'Platform',
  lineItemMode: 'Standard',
  variant: {
    id: 1,
    sku: 'variant-sku-1',
  },
};

const customLineItem: CustomLineItem = {
  id: 'customLineItem-id-1',
  name: {
    en: 'customLineItem-name-1',
  },
  slug: '',
  money: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  quantity: 1,
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  discountedPricePerQuantity: [],
  taxedPricePortions: [],
  state: [],
  perMethodTaxRate: [],
  priceMode: 'Platform',
};

const shippingInfo: ShippingInfo = {
  shippingMethodName: 'shippingMethodName1',
  price: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  shippingRate: {
    price: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 1000,
      fractionDigits: 2,
    },
    tiers: [],
  },
  shippingMethodState: 'MatchesCart',
};
