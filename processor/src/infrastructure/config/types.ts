/** The processor's own application configuration, field by field as `config.ts` builds it. */
export interface AppConfig {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  jwksUrl: string;
  jwtIssuer: string;
  authUrl: string;
  apiUrl: string;
  sessionUrl: string;
  checkoutUrl: string;
  healthCheckTimeout: number;
  /** Hard bound on one vendor call, a connector constant rather than a deployment knob. */
  requestTimeoutMs: number;
  loggerLevel: string;
  /** The Merchant Center permission every merchant `/operations` route requires; a brand value. */
  configManagePermission: string;
  /** Allowlisted storefront origins for shopper return URLs; empty fails closed. */
  allowedReturnOrigins: string[];
  /** The safe sink the return leg redirects to on any failure. */
  returnFailureUrl: string | undefined;
}
