/**
 * The processor's payment-panel wire contract, as the Custom View consumes it. The authority is the
 * TypeBox schema the processor serializes with
 * (`infrastructure/http/dtos/operations/order-payments.dto.ts`); these types mirror it field for field.
 *
 * The view never talks to commercetools or the vendor: every field below is served by the processor's
 * `/operations/*` routes over the MC `/proxy/forward-to` gateway. The headroom amounts come from
 * commercetools and gate the actions; `details` is the provider's own read of the payment — the amount
 * book and the transaction legs the card DISPLAYS, never an input to what an action is
 * allowed to do.
 */

/** Money as commercetools models it, wired verbatim by the processor. */
export type MoneyDto = {
  centAmount: number;
  currencyCode: string;
};

/**
 * One provider transaction leg of the payment — a row of the card's history table. Every member but
 * the list itself is optional because the vendor's own wire makes it so: an absent value renders the
 * no-value fallback in its cell, never an invented figure.
 */
export type PaymentOperationDto = {
  /** The leg's own id at the vendor — the "Transaction ID" column. */
  id?: string;
  /** Display kind: `authorization` | `charge` | `refund` | `reversal`, or the vendor's leg kind
   * verbatim when unrecognised. */
  type?: string;
  /** ISO timestamp of the leg. A value that names no instant renders the no-value fallback. */
  date?: string;
  /** The leg's tri-state outcome — the status pill. Absent means the leg carries no pill. */
  outcome?: 'success' | 'pending' | 'error';
  amount?: MoneyDto;
};

/**
 * The payment's cumulative amounts as the provider reports them - display only. The book is
 * optional member by member because the vendor's own field is optional on the wire; an absent figure
 * renders the no-value fallback, never a commercetools-derived substitute.
 */
export type PaymentDetailsAmountsDto = {
  total?: MoneyDto;
  authorized?: MoneyDto;
  charged?: MoneyDto;
  cancelled?: MoneyDto;
  refunded?: MoneyDto;
};

/**
 * The provider's view of a payment: the vendor status, the vendor's own order reference (
 * this connector stamps the CT payment id there), the amount book and the transaction legs.
 * `rawStatus` and `operations` are guaranteed; everything else is omitted where the vendor reported
 * nothing.
 */
export type PaymentDetailsDto = {
  /** The vendor status string, verbatim — display only. */
  rawStatus: string;
  /** The vendor's own order reference on the payment, verbatim. */
  orderId?: string;
  amounts?: PaymentDetailsAmountsDto;
  operations: PaymentOperationDto[];
};

/**
 * The provider read failed for this payment (PSP unreachable, store not connected). The card still
 * renders every commercetools-sourced field and shows the reason with a retry, and the actions stay
 * enabled. `unavailable` is the discriminant - the operator-facing text is `reason`.
 */
export type PaymentDetailsUnavailableDto = {
  unavailable: true;
  reason: string;
};

/** A connector-owned payment of the order, with its amounts already aggregated by the processor. */
export type OrderPaymentDto = {
  /** The commercetools Payment id — the id an action posts against. */
  id: string;
  /** The vendor's payment id — the merchant-facing payment number. */
  providerPaymentId?: string;
  merchantReference?: string;
  inReview: boolean;
  /** The commercetools payment method — the one source of the method the card displays. */
  paymentMethod?: string;
  amountPlanned: MoneyDto;
  /**
   * The minor-unit exponent commercetools stores this payment's amounts in
   * (`amountPlanned.fractionDigits`). Every amount of the payment is in its one currency, so the scale is
   * stated once here and applies to all of them. The panel must not resolve it locally: `Intl` answers 0
   * minor digits for `RSD` where commercetools stores 2, which would submit 5.00 RSD for a 500.00 RSD
   * capture.
   */
  fractionDigits: number;
  /** The capture headroom — the processor rejects a capture beyond it with 400. */
  capturableAmount: MoneyDto;
  /** The refund headroom — the processor rejects a refund beyond it with 400. */
  refundableAmount: MoneyDto;
  details: PaymentDetailsDto | PaymentDetailsUnavailableDto;
};

/** `GET /operations/orders/:orderId/payments` — the whole panel in one response. */
export type OrderPaymentsDto = {
  payments: OrderPaymentDto[];
};

/**
 * The three merchant-initiated actions the panel offers. An amount is carried only where
 * the operator chooses one: a cancel voids the authorization whole, so it names no amount.
 */
export type PaymentIntentActionDto =
  | { action: 'capturePayment'; amount: MoneyDto }
  | { action: 'refundPayment'; amount: MoneyDto }
  // `amount` voids PART of what is still authorized; omitted, the whole capture headroom is voided.
  | { action: 'cancelPayment'; amount?: MoneyDto };

/** `POST /operations/payments/:id/intents` — the processor accepts exactly one action per request. */
export type PaymentIntentRequestDto = {
  actions: [PaymentIntentActionDto];
};

export type PaymentIntentResponseDto = {
  outcome: 'approved' | 'rejected' | 'received';
};

/** The provider read of a payment succeeded — narrowed from the union the processor sends. */
export const hasPaymentDetails = (
  details: OrderPaymentDto['details']
): details is PaymentDetailsDto => !('unavailable' in details);
