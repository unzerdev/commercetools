import type { ReturnContext, ReturnResolveRequest, ReturnResolveResult, StoreConfig } from '../../../domain';

/** The shopper return leg: reads the provider's own context back off a CT Payment and resolves the return fail-closed. */
export interface ReturnHandler {
  readContext(fields: Record<string, unknown>): ReturnContext;

  /** Verifies authenticity before any vendor call, then reads the definitive status. */
  resolve(cfg: StoreConfig, req: ReturnResolveRequest): Promise<ReturnResolveResult>;
}
