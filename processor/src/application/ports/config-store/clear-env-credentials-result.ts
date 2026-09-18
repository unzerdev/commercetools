/** The outcome of clearing one environment's credentials. */
export interface ClearEnvCredentialsResult {
  /** `true` when another environment still holds credentials; `false` means the caller deletes the whole object. */
  remainingCredentials: boolean;
  /** The version for the caller's next CAS operation. */
  version: number;
}
