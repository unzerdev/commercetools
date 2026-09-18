import type { OrchestrationCtx } from '../shared';

/** The raw return-URL query parameters exactly as received. */
export interface ReflectReturnCtx extends OrchestrationCtx {
  query: Record<string, string | undefined>;
}
