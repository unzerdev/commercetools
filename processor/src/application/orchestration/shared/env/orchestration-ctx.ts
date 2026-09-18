import type { OrchestrationEnv } from './orchestration-env';

/** The base context every orchestrator receives; per-operation contexts extend it. */
export interface OrchestrationCtx {
  env: OrchestrationEnv;
}
