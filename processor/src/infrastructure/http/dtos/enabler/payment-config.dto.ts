import { Static, Type } from '@sinclair/typebox';
import { CustomerTypeSchema, EnvironmentModeSchema, SalutationSchema } from '../shared/primitives.dto';

const PaymentMethodSchema = Type.Object({
  code: Type.String(),
  name: Type.String(),
  description: Type.String(),
  surcharge: Type.Integer({ minimum: 0 }),
  logo: Type.Optional(Type.String()),
  requiresCustomerData: Type.Boolean(),
  needsAmountData: Type.Boolean(),
  rendersOwnPayButton: Type.Boolean(),
  wallet: Type.Optional(
    Type.Object(
      {
        kind: Type.Union([Type.Literal('applepay'), Type.Literal('googlepay')]),
        payload: Type.Record(Type.String(), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  ),
  clickToPayEnabled: Type.Optional(Type.Boolean()),
});

const PrefillAddressSchema = Type.Object(
  {
    street: Type.Optional(Type.String()),
    houseNumber: Type.Optional(Type.String()),
    postalCode: Type.Optional(Type.String()),
    city: Type.Optional(Type.String()),
    countryCode: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    company: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** The shopper's own data returning to their browser; strict so no credential or resource id can be added by accident. */
const ShopperPrefillSchema = Type.Object(
  {
    customerReference: Type.Optional(Type.String()),
    vendorCustomerId: Type.Optional(Type.String()),
    firstName: Type.Optional(Type.String()),
    lastName: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    salutation: Type.Optional(SalutationSchema),
    dateOfBirth: Type.Optional(Type.String({ pattern: '^\\d{8}$' })),
    phone: Type.Optional(Type.String()),
    mobile: Type.Optional(Type.String()),
    company: Type.Optional(Type.String()),
    billingAddress: Type.Optional(PrefillAddressSchema),
    shippingAddress: Type.Optional(PrefillAddressSchema),
  },
  { additionalProperties: false },
);

/** `GET /operations/payment-config`: the vendor public key only, never a secret. */
export const PaymentConfigResponseSchema = Type.Object({
  publicKey: Type.String(),
  environment: EnvironmentModeSchema,
  locale: Type.String(),
  currency: Type.String(),
  fractionDigits: Type.Integer({ minimum: 0 }),
  amount: Type.Integer({ minimum: 0 }),
  country: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
  customerType: CustomerTypeSchema,
  paymentMethods: Type.Array(PaymentMethodSchema),
  shopper: Type.Optional(ShopperPrefillSchema),
});

export type PaymentConfigResponseSchemaDTO = Static<typeof PaymentConfigResponseSchema>;
