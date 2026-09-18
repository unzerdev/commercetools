import type { CustomTypeDeclaration } from '../../domain';

/** Idempotently provisions the commercetools objects the connector owns: the payment custom type and the payment states. */
export interface Provisioning {
  /** Create or extend the payment custom type, then drop the connector-owned fields the declaration no longer carries. */
  ensurePaymentType(declaration: CustomTypeDeclaration, ownsField: (fieldName: string) => boolean): Promise<void>;

  /** Create every `PaymentState` the connector writes; an existing state of another type fails. */
  ensurePaymentStates(): Promise<void>;

  /** The connector-owned objects that are not provisioned yet, named for a merchant; empty when all exist. */
  missingObjects(paymentTypeKey: string): Promise<string[]>;
}
