/**
 * A processor call that did not do what it was asked to do — and the words for it, where the processor
 * itself supplied none.
 *
 * The processor names most of its own failures (a 400 that says what the operator did wrong), and that
 * text is what the panel shows. Four outcomes it cannot leave to the processor's text:
 *
 * - a failure that never reached the processor (an MC gateway 502 carries an HTML body and no reason),
 * - a failure that produced no response at all (offline, DNS, a rejected `fetch` — the browser's own
 *   English `Failed to fetch` is not an answer),
 * - a 409: the operation lost the version race, so the payment moved and NOTHING reached the vendor.
 *   The processor words that in English, but it is the panel that owns the affordance it calls for
 *   (a re-read), so the panel owns the wording with it.
 * - the vendor's REFUSAL, which is not an HTTP failure at all: the vendor declines in a 200 body
 *   (`{ outcome: 'rejected' }`) and the processor passes that answer on with no message whatsoever.
 *   Raised as the failure it is — the operation did not happen — so that one reading of `intent.error`
 *   covers every way an action can fail to move money.
 *
 * Those words are NOT the transport's: it carries the intl id and the ICU values, the render site
 * formats them through the panel's catalogue, and every string an operator reads stays translatable
 * (the panel spec proves it through the German catalogue).
 */

/** The ids the panel words itself. A plain string union — never a react-intl descriptor. */
export type ProcessorErrorMessageId =
  | 'PaymentsPanel.processorUnreachable'
  | 'PaymentsPanel.processorOffline'
  | 'PaymentsPanel.concurrentModification'
  | 'PaymentsPanel.operationRefused';

export class ProcessorError extends Error {
  /**
   * The panel's own text for this failure, when the processor supplied none. Unset means the
   * processor named the reason itself and `message` IS what the operator reads.
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

/**
 * The lost version race. It is the one failure that is not a failure: the payment moved, nothing
 * reached the vendor, and the answer is to re-read the panel — so the render site needs to recognize
 * it to offer that, not merely to word it.
 */
export const isConcurrentModification = (error: unknown): boolean =>
  isProcessorError(error) &&
  error.messageId === 'PaymentsPanel.concurrentModification';
