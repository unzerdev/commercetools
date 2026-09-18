/** The commercetools Customer behind a session cart, read for the one datum the cart lacks. */
export interface CustomerReader {
  /** `YYYYMMDD`, or `undefined` for an absent customer, an absent date or any platform failure. Never throws. */
  dateOfBirth(customerId: string): Promise<string | undefined>;
}
