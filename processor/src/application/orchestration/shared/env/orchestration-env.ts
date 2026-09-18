import type { OrchestrationLogger } from './orchestration-logger';
import type { StatusEnv } from './status-env';

/** The resolved deployment environment an orchestrator reads, injected rather than read from singletons. */
export interface OrchestrationEnv {
  logger: OrchestrationLogger;
  brand: { paymentInterface: string };
  /** The connector's own public `/return` endpoint; also the logo serve origin. */
  returnUrl?: string;
  /** The safe failure sink the return leg redirects to on any failure. */
  returnFailureUrl?: string;
  /** Allowlisted storefront origins for shopper return URLs. */
  allowedReturnOrigins: string[];
  status: StatusEnv;
}
