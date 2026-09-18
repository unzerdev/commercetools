/** One store in the merchant config app's selector. */
export interface StoreSummary {
  key: string;
  name: string;
  /** Set on the synthetic default-scope entry, always first. */
  isDefault?: boolean;
}
