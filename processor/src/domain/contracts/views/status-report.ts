import type { StatusCheck } from './status-check';

/** The composed connector status served by `GET /operations/status`. */
export interface StatusReport {
  status: string;
  timestamp: string;
  version: string;
  metadata?: unknown;
  checks: StatusCheck[];
}
