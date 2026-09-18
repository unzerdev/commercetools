/**
 * The failure of a processor call, as the transport can describe it — and no further.
 *
 * The processor names most of its own failures (a 400 that says which credential is wrong), and that
 * text is what the operator reads. Two outcomes it cannot word for us:
 *
 * - a failure that never reached the processor (an MC gateway 502 carries an HTML body and no reason),
 * - a failure that produced no response at all (offline, DNS, a rejected `fetch` — the browser's own
 *   English `Failed to fetch` is not an answer).
 *
 * The words for those are NOT the transport's: it carries the intl id and the ICU values, the render
 * site formats them through the app's catalogue, and every string an operator reads stays translatable.
 */

/** The ids the transport can raise. A plain string union — never a react-intl descriptor. */
export type ProcessorErrorMessageId =
  'ConfigApp.processorUnreachable' | 'ConfigApp.processorOffline';

export class ProcessorError extends Error {
  /**
   * The app's own text for this failure, when the processor supplied none. Unset means the processor
   * named the reason itself and `message` IS what the operator reads.
   */
  readonly messageId?: ProcessorErrorMessageId;

  /** The ICU values of `messageId`. */
  readonly values?: Record<string, string | number>;

  constructor(
    message: string,
    messageId?: ProcessorErrorMessageId,
    values?: Record<string, string | number>
  ) {
    super(message);
    this.name = 'ProcessorError';
    this.messageId = messageId;
    this.values = values;
  }
}

export const isProcessorError = (error: unknown): error is ProcessorError =>
  error instanceof ProcessorError;
