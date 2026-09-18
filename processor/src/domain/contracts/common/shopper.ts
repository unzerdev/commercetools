import type { Salutation } from './salutation';

/** The shopper identity every payer shape in the connector shares. Every field is optional. */
export interface Shopper {
  firstName?: string;
  lastName?: string;
  email?: string;
  salutation?: Salutation;
  /** `YYYYMMDD`. */
  dateOfBirth?: string;
}
