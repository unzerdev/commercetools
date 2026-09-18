import type { CtTransactionType } from '../../../domain';

/** The handle a reserved leg is found by: its type and the id it is keyed on. The type is half the handle. */
export interface ReservedLeg {
  type: CtTransactionType;
  interactionId: string;
}
