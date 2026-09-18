/** The outcome of validating a settings document against the provider-owned schema. */
export interface ConfigValidationResult {
  valid: boolean;
  /** Secret-free, path-carrying messages; present when invalid. */
  errors?: string[];
}
