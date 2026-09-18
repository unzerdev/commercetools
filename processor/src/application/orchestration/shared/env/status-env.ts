import type { Logger as SdkLogger } from '@commercetools/connect-payments-sdk';

/** The `GET /operations/status` composition inputs. */
export interface StatusEnv {
  logger: SdkLogger;
  /** Health-check timeout in ms. */
  timeout: number;
  metadata: Record<string, string>;
  /** The commercetools scopes the connector needs; the health check probes every one. */
  requiredPermissions: string[];
}
