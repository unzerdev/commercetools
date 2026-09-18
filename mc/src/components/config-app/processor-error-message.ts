import type { IntlShape, MessageDescriptor } from 'react-intl';
import {
  isProcessorError,
  type ProcessorErrorMessageId,
} from '../../processor';
import messages from './messages';

/**
 * What the operator reads when a processor call failed. The processor's own message is already
 * operator-facing and secret-free, so it stands as it is; a failure it never named arrives as an intl
 * id, and the config screen — the only layer that owns wording — resolves it here. The map is
 * exhaustive by type: a new transport id does not compile until it has a translated string.
 *
 * The `fallback` is what a rejection that is no `Error` at all (or carries an empty message) reads as —
 * per call site, because "could not save" and "could not refresh the methods" are different answers.
 */
const transportMessages: Record<ProcessorErrorMessageId, MessageDescriptor> = {
  'ConfigApp.processorUnreachable': messages.processorUnreachable,
  'ConfigApp.processorOffline': messages.processorOffline,
};

export const formatProcessorError = (
  intl: IntlShape,
  error: unknown,
  fallback: string
): string => {
  if (isProcessorError(error) && error.messageId) {
    return intl.formatMessage(transportMessages[error.messageId], error.values);
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

/**
 * Like {@link formatProcessorError}, but the processor's OWN message is never shown — `generic` always
 * stands in for it. Use this where the processor relays the VENDOR's words, which are unfit for an
 * operator: the credential-validating `PUT /operations/store-config` answers with Unzer's HTTP status
 * and a partially-masked key ("PSP API error (401): The given key s-p****fds is unknown or invalid").
 * That text is untranslatable, echoes part of a credential into the UI, and names no remedy.
 *
 * A translatable TRANSPORT failure still wins over `generic`, because "the connector cannot be
 * reached" and "your keys are wrong" call for different actions and the operator must be able to tell
 * them apart. Everything else — including a 4xx the processor worded itself — reads as `generic`.
 */
export const formatProcessorErrorGeneric = (
  intl: IntlShape,
  error: unknown,
  generic: string
): string => {
  if (isProcessorError(error) && error.messageId) {
    return intl.formatMessage(transportMessages[error.messageId], error.values);
  }
  return generic;
};
