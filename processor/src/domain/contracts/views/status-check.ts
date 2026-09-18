/** One health check in the status report. */
export interface StatusCheck {
  name: string;
  status: 'UP' | 'DOWN' | 'PARTIALLY_AVAILABLE';
  message?: string;
  details?: Record<string, unknown>;
}
