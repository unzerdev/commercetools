/** The structured logger the orchestration writes diagnostics through; callers log messages, never raw error objects. */
export interface OrchestrationLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
