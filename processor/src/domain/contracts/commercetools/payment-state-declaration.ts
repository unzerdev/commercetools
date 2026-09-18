import type { LocalizedText } from '../common';
import type { PaymentStatusStateKey } from './payment-status-state-key';

/** A commercetools `State` the connector registers. No `transitions`: unset means every transition is allowed. */
export interface PaymentStateDeclaration {
  key: PaymentStatusStateKey;
  type: 'PaymentState';
  name: LocalizedText;
  /** The lifecycle's entry state; exactly one declaration sets it. */
  initial?: boolean;
}
