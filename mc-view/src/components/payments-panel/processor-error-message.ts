import type { IntlShape, MessageDescriptor } from 'react-intl';
import {
  isProcessorError,
  type ProcessorErrorMessageId,
} from '../../hooks/use-processor-client';
import messages from './messages';

/**
 * What the operator reads when an action did not move the money. The processor's own message is already
 * operator-facing and secret-free, so it stands as it is; a failure it never named — a dead gateway, or
 * the vendor's own refusal, which it answers with an outcome and no words at all — arrives as an intl id,
 * and the panel, the only layer that owns wording, resolves it here. The map is exhaustive by type: an id
 * with no English wording here does not compile. That every catalogue then carries that wording is
 * `load-messages.spec.ts`'s job, after `extract-intl` — not the compiler's.
 */
const panelMessages: Record<ProcessorErrorMessageId, MessageDescriptor> = {
  'PaymentsPanel.processorUnreachable': messages.processorUnreachable,
  'PaymentsPanel.processorOffline': messages.processorOffline,
  'PaymentsPanel.concurrentModification': messages.concurrentModification,
  'PaymentsPanel.operationRefused': messages.operationRefused,
};

export const formatProcessorError = (intl: IntlShape, error: Error): string =>
  isProcessorError(error) && error.messageId
    ? intl.formatMessage(panelMessages[error.messageId], error.values)
    : error.message;
