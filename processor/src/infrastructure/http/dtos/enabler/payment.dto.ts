import { Static, Type } from '@sinclair/typebox';
import { SalutationSchema } from '../shared/primitives.dto';

const CollectedAddressSchema = Type.Object(
  {
    street: Type.Optional(Type.String({ maxLength: 256 })),
    houseNumber: Type.Optional(Type.String({ maxLength: 64 })),
    postalCode: Type.Optional(Type.String({ maxLength: 32 })),
    city: Type.Optional(Type.String({ maxLength: 128 })),
    countryCode: Type.Optional(Type.String({ pattern: '^[A-Za-z]{2}$' })),
    state: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);

/** What the checkout surface collected from the shopper; strict so nothing unexpected reaches the vendor. */
const CollectedCustomerSchema = Type.Object(
  {
    firstName: Type.Optional(Type.String({ maxLength: 128 })),
    lastName: Type.Optional(Type.String({ maxLength: 128 })),
    email: Type.Optional(Type.String({ maxLength: 256 })),
    phone: Type.Optional(Type.String({ maxLength: 64 })),
    salutation: Type.Optional(SalutationSchema),
    dateOfBirth: Type.Optional(Type.String({ pattern: '^\\d{8}$' })),
    billingAddress: Type.Optional(CollectedAddressSchema),
    shippingAddress: Type.Optional(CollectedAddressSchema),
  },
  { additionalProperties: false },
);

/** `POST /payments`: every free-text field is length-bounded. */
export const PaymentRequestSchema = Type.Object({
  paymentMethodCode: Type.String({ maxLength: 128, description: 'The chosen payment method code.' }),
  resourceId: Type.String({ maxLength: 256, description: 'The vendor payment type id the browser tokenized.' }),
  returnUrl: Type.String({
    maxLength: 2048,
    description: 'Shopper storefront return URL, validated against the allowlist.',
  }),
  deviceFingerprintId: Type.Optional(
    Type.String({ maxLength: 256, description: 'Opaque device-fingerprint id for risk assessment.' }),
  ),
  collectedCustomer: Type.Optional(CollectedCustomerSchema),
  vendorCustomerId: Type.Optional(
    Type.String({ maxLength: 256, description: "The vendor customer the checkout surface's own form created." }),
  ),
  locale: Type.Optional(Type.String({ maxLength: 35, description: 'BCP-47 locale.' })),
});

/** The open follow-up action union: redirect, sdkAction, display or none. */
export const FollowUpActionSchema = Type.Union([
  Type.Object({ kind: Type.Literal('redirect'), payload: Type.Object({ url: Type.String() }) }),
  Type.Object({ kind: Type.Literal('sdkAction'), payload: Type.Record(Type.String(), Type.Unknown()) }),
  Type.Object({ kind: Type.Literal('display'), payload: Type.Record(Type.String(), Type.Unknown()) }),
  Type.Object({ kind: Type.Literal('none') }),
]);

export const PaymentResponseSchema = Type.Object({
  paymentReference: Type.String(),
  action: FollowUpActionSchema,
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
