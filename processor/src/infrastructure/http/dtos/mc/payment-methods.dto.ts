import { Static, Type } from '@sinclair/typebox';
import {
  BookingModeSchema,
  CurrencyAmountMapSchema,
  EnvironmentModeSchema,
  LocalizedTextSchema,
} from '../shared/primitives.dto';

const GOOGLE_PAY_BUTTON_TYPES = ['book', 'buy', 'checkout', 'donate', 'order', 'pay', 'plain', 'subscribe'] as const;

const GooglePayConfigSchema = Type.Object(
  {
    gatewayMerchantId: Type.Optional(Type.String()),
    merchantId: Type.Optional(Type.String()),
    merchantName: Type.Optional(Type.String()),
    countryCode: Type.Optional(Type.Union([Type.Literal('DK'), Type.Literal('CH')])),
    allowedCardNetworks: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    allowCreditCards: Type.Optional(Type.Boolean()),
    allowPrepaidCards: Type.Optional(Type.Boolean()),
    buttonColor: Type.Optional(Type.Union([Type.Literal('default'), Type.Literal('black'), Type.Literal('white')])),
    buttonType: Type.Optional(Type.Union(GOOGLE_PAY_BUTTON_TYPES.map((t) => Type.Literal(t)))),
    buttonSizeMode: Type.Optional(Type.Union([Type.Literal('static'), Type.Literal('fill')])),
  },
  { additionalProperties: false },
);

const ApplePayConfigSchema = Type.Object(
  {
    supportedNetworks: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const paymentMethodConfigProperties = {
  paymentMethodCode: Type.String(),
  enabled: Type.Boolean(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema,
  bookingMode: Type.Optional(BookingModeSchema),
  minAmount: Type.Optional(CurrencyAmountMapSchema),
  maxAmount: Type.Optional(CurrencyAmountMapSchema),
  surcharge: CurrencyAmountMapSchema,
  countries: Type.Array(Type.String({ pattern: '^[A-Z]{2}$' })),
  sendBasketData: Type.Boolean(),
  clickToPayEnabled: Type.Optional(Type.Boolean()),
  googlePay: Type.Optional(GooglePayConfigSchema),
  applePay: Type.Optional(ApplePayConfigSchema),
};

/** The persisted per-method config; strict, so a derived read-only field can never be written back. */
const PaymentMethodConfigSchema = Type.Object(paymentMethodConfigProperties, { additionalProperties: false });

/** The GET view: the persisted config plus the read-only capabilities and coverage the catalogue derives. */
const PaymentMethodViewSchema = Type.Object(
  {
    ...paymentMethodConfigProperties,
    logo: Type.Optional(Type.String()),
    supportsAuthorize: Type.Boolean(),
    supportsCharge: Type.Boolean(),
    vendorCountries: Type.Array(Type.String()),
    vendorCurrencies: Type.Array(Type.String()),
    vendorCustomerTypes: Type.Array(Type.String()),
    vendorChannel: Type.Optional(Type.String()),
    vendorCardNetworks: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const PaymentMethodsRequestSchema = Type.Object(
  { paymentMethods: Type.Array(PaymentMethodConfigSchema) },
  { additionalProperties: false },
);

export const PaymentMethodsResponseSchema = PaymentMethodsRequestSchema;

export const PaymentMethodsViewResponseSchema = Type.Object(
  { paymentMethods: Type.Array(PaymentMethodViewSchema) },
  { additionalProperties: false },
);

/** `mode` selects the environment read or written; the store travels in `X-Store-Key`. */
export const PaymentMethodsQuerySchema = Type.Object({
  mode: Type.Optional(EnvironmentModeSchema),
});

export type PaymentMethodsRequestSchemaDTO = Static<typeof PaymentMethodsRequestSchema>;
export type PaymentMethodsResponseSchemaDTO = Static<typeof PaymentMethodsResponseSchema>;
export type PaymentMethodsViewResponseSchemaDTO = Static<typeof PaymentMethodsViewResponseSchema>;
export type PaymentMethodsQuerySchemaDTO = Static<typeof PaymentMethodsQuerySchema>;
