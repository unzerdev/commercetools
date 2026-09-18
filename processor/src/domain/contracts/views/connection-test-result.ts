/** The secret-free outcome of a live credential probe. */
export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  /** The connection field the failure belongs to, relative to the environment block (`credentials.publicKey`). */
  field?: string;
}
