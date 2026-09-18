import { defineMessages } from 'react-intl';

export default defineMessages({
  orderIdMissing: {
    id: 'PaymentsPanel.orderIdMissing',
    defaultMessage:
      'This panel could not determine which order it is embedded in.',
  },
  loading: {
    id: 'PaymentsPanel.loading',
    defaultMessage: 'Loading the payments of this order',
  },
  retry: {
    id: 'PaymentsPanel.retry',
    defaultMessage: 'Retry',
  },
  refresh: {
    id: 'PaymentsPanel.refresh',
    defaultMessage: 'Refresh the panel',
  },
  noPayments: {
    id: 'PaymentsPanel.noPayments',
    defaultMessage: 'This order has no payments from this connector.',
  },
  processorUnreachable: {
    id: 'PaymentsPanel.processorUnreachable',
    defaultMessage:
      'Something went wrong reaching the payment connector. (HTTP {status})',
  },
  processorOffline: {
    id: 'PaymentsPanel.processorOffline',
    defaultMessage:
      'The payment connector cannot be reached. Check your network connection and try again.',
  },
  concurrentModification: {
    id: 'PaymentsPanel.concurrentModification',
    defaultMessage:
      'This payment changed while you were working on it. Nothing was sent to the payment provider. Refresh the panel and try again.',
  },
  refreshFailed: {
    id: 'PaymentsPanel.refreshFailed',
    defaultMessage:
      'This panel could not be refreshed. The figures below are from the last successful read and may be out of date. {reason}',
  },
  // The processor hands the money back best-effort — a failed release leaves the headroom shut — so the
  // refusal promises only what it can: nothing moved, and the refreshed panel states the rest.
  operationRefused: {
    id: 'PaymentsPanel.operationRefused',
    defaultMessage:
      'The payment provider refused this operation. No money was moved. The refreshed panel shows the amount that is available for this action.',
  },
  cardTitle: {
    id: 'PaymentsPanel.cardTitle',
    defaultMessage: 'Unzer Payments',
  },
  paymentSectionTitle: {
    id: 'PaymentsPanel.paymentSectionTitle',
    defaultMessage: '{payment}',
  },
  inReview: {
    id: 'PaymentsPanel.inReview',
    defaultMessage: 'Under review',
  },
  summaryDate: {
    id: 'PaymentsPanel.summaryDate',
    defaultMessage: 'Date',
  },
  summaryPaymentId: {
    id: 'PaymentsPanel.summaryPaymentId',
    defaultMessage: 'Payment ID',
  },
  // The label states the field's provenance exactly as the vendor names it.
  summaryOrderId: {
    id: 'PaymentsPanel.summaryOrderId',
    defaultMessage: 'Order ID',
  },
  summaryMethod: {
    id: 'PaymentsPanel.summaryMethod',
    defaultMessage: 'Payment method',
  },
  summaryTotal: {
    id: 'PaymentsPanel.summaryTotal',
    defaultMessage: 'Total',
  },
  summaryAuthorized: {
    id: 'PaymentsPanel.summaryAuthorized',
    defaultMessage: 'Authorized',
  },
  summaryCharged: {
    id: 'PaymentsPanel.summaryCharged',
    defaultMessage: 'Charged',
  },
  summaryCancelled: {
    id: 'PaymentsPanel.summaryCancelled',
    defaultMessage: 'Cancelled',
  },
  summaryRefunded: {
    id: 'PaymentsPanel.summaryRefunded',
    defaultMessage: 'Refunded',
  },
  tableDate: {
    id: 'PaymentsPanel.tableDate',
    defaultMessage: 'Date',
  },
  tablePaymentId: {
    id: 'PaymentsPanel.tablePaymentId',
    defaultMessage: 'Payment ID',
  },
  tableTransactionId: {
    id: 'PaymentsPanel.tableTransactionId',
    defaultMessage: 'Transaction ID',
  },
  tableMethod: {
    id: 'PaymentsPanel.tableMethod',
    defaultMessage: 'Payment method',
  },
  tableType: {
    id: 'PaymentsPanel.tableType',
    defaultMessage: 'Type',
  },
  tableStatus: {
    id: 'PaymentsPanel.tableStatus',
    defaultMessage: 'Status',
  },
  tableAmount: {
    id: 'PaymentsPanel.tableAmount',
    defaultMessage: 'Amount',
  },
  legTypeAuthorization: {
    id: 'PaymentsPanel.legTypeAuthorization',
    defaultMessage: 'Authorization',
  },
  legTypeCharge: {
    id: 'PaymentsPanel.legTypeCharge',
    defaultMessage: 'Charge',
  },
  legTypeRefund: {
    id: 'PaymentsPanel.legTypeRefund',
    defaultMessage: 'Refund',
  },
  legTypeReversal: {
    id: 'PaymentsPanel.legTypeReversal',
    defaultMessage: 'Reversal',
  },
  statusSuccess: {
    id: 'PaymentsPanel.statusSuccess',
    defaultMessage: 'Success',
  },
  statusPending: {
    id: 'PaymentsPanel.statusPending',
    defaultMessage: 'Pending',
  },
  statusError: {
    id: 'PaymentsPanel.statusError',
    defaultMessage: 'Error',
  },
  noTransactions: {
    id: 'PaymentsPanel.noTransactions',
    defaultMessage: 'No transactions have been recorded for this payment yet.',
  },
  captureButton: {
    id: 'PaymentsPanel.captureButton',
    defaultMessage: 'Capture',
  },
  refundButton: {
    id: 'PaymentsPanel.refundButton',
    defaultMessage: 'Refund',
  },
  cancelButton: {
    id: 'PaymentsPanel.cancelButton',
    defaultMessage: 'Cancel',
  },
  // Each amount input names the action it feeds — with several cards on an order, a screen-reader
  // operator must be able to tell a capture input from a refund input by its accessible name alone.
  captureAmountLabel: {
    id: 'PaymentsPanel.captureAmountLabel',
    defaultMessage: 'Capture amount',
  },
  refundAmountLabel: {
    id: 'PaymentsPanel.refundAmountLabel',
    defaultMessage: 'Refund amount',
  },
  amountNotPositive: {
    id: 'PaymentsPanel.amountNotPositive',
    defaultMessage: 'Enter an amount greater than zero.',
  },
  // A figure outside the accepted grammar is not a figure the operator can be told is "not positive":
  // `1,234` is positive and was typed on purpose. The refusal names the format instead, at the payment's
  // own minor digits.
  amountFormatInvalid: {
    id: 'PaymentsPanel.amountFormatInvalid',
    defaultMessage:
      'Enter the amount as digits with at most {digits} decimal places, for example {example}.',
  },
  amountAboveMaximum: {
    id: 'PaymentsPanel.amountAboveMaximum',
    defaultMessage:
      'The amount exceeds the {amount} available for this action.',
  },
  captureDialogTitle: {
    id: 'PaymentsPanel.captureDialogTitle',
    defaultMessage: 'Capture payment',
  },
  captureConfirmBody: {
    id: 'PaymentsPanel.captureConfirmBody',
    defaultMessage: 'The payment provider will be asked to capture {amount}.',
  },
  refundDialogTitle: {
    id: 'PaymentsPanel.refundDialogTitle',
    defaultMessage: 'Refund payment',
  },
  refundConfirmBody: {
    id: 'PaymentsPanel.refundConfirmBody',
    defaultMessage: 'The payment provider will be asked to refund {amount}.',
  },
  cancelDialogTitle: {
    id: 'PaymentsPanel.cancelDialogTitle',
    defaultMessage: 'Cancel this payment?',
  },
  cancelAmountLabel: {
    id: 'PaymentsPanel.cancelAmountLabel',
    defaultMessage: 'Cancel amount',
  },
  transactionsTitle: {
    id: 'PaymentsPanel.transactionsTitle',
    defaultMessage: 'Transactions',
  },
  cancelDialogBody: {
    id: 'PaymentsPanel.cancelDialogBody',
    defaultMessage:
      'Cancelling voids the remaining authorization: nothing more can be captured. The cancellation is recorded for the {amount} that is still capturable.',
  },
  confirmButton: {
    id: 'PaymentsPanel.confirmButton',
    defaultMessage: 'Confirm',
  },
  dismissButton: {
    id: 'PaymentsPanel.dismissButton',
    defaultMessage: 'Cancel',
  },

  // The summary's own column headers, plus the two fields the panel gained: the vendor payment state
  // and the currency every amount on the card is denominated in.
  summaryState: {
    id: 'PaymentsPanel.summaryState',
    defaultMessage: 'State',
  },
  summaryCurrency: {
    id: 'PaymentsPanel.summaryCurrency',
    defaultMessage: 'Currency',
  },
  method_card: {
    id: 'PaymentsPanel.method_card',
    defaultMessage: 'Card',
  },
  method_paypal: {
    id: 'PaymentsPanel.method_paypal',
    defaultMessage: 'PayPal',
  },
  method_wero: {
    id: 'PaymentsPanel.method_wero',
    defaultMessage: 'Wero',
  },
  method_applepay: {
    id: 'PaymentsPanel.method_applepay',
    defaultMessage: 'Apple Pay',
  },
  method_googlepay: {
    id: 'PaymentsPanel.method_googlepay',
    defaultMessage: 'Google Pay',
  },
  method_klarna: {
    id: 'PaymentsPanel.method_klarna',
    defaultMessage: 'Klarna',
  },
  method_paylater_invoice: {
    id: 'PaymentsPanel.method_paylater_invoice',
    defaultMessage: 'Unzer Invoice',
  },
  method_paylater_installment: {
    id: 'PaymentsPanel.method_paylater_installment',
    defaultMessage: 'Unzer Installment',
  },
  method_paylater_direct_debit: {
    id: 'PaymentsPanel.method_paylater_direct_debit',
    defaultMessage: 'Unzer Direct Debit',
  },
  method_installment_secured: {
    id: 'PaymentsPanel.method_installment_secured',
    defaultMessage: 'Installment Secured',
  },
  method_invoice_secured: {
    id: 'PaymentsPanel.method_invoice_secured',
    defaultMessage: 'Invoice Secured',
  },
  method_alipay: {
    id: 'PaymentsPanel.method_alipay',
    defaultMessage: 'Alipay',
  },
  method_bancontact: {
    id: 'PaymentsPanel.method_bancontact',
    defaultMessage: 'Bancontact',
  },
  method_clicktopay: {
    id: 'PaymentsPanel.method_clicktopay',
    defaultMessage: 'Click to Pay',
  },
  method_EPS: {
    id: 'PaymentsPanel.method_EPS',
    defaultMessage: 'EPS',
  },
  method_ideal: {
    id: 'PaymentsPanel.method_ideal',
    defaultMessage: 'iDEAL',
  },
  method_openbanking_pis: {
    id: 'PaymentsPanel.method_openbanking_pis',
    defaultMessage: 'Open Banking',
  },
  method_payu: {
    id: 'PaymentsPanel.method_payu',
    defaultMessage: 'PayU',
  },
  method_post_finance_card: {
    id: 'PaymentsPanel.method_post_finance_card',
    defaultMessage: 'PostFinance Card',
  },
  method_post_finance_efinance: {
    id: 'PaymentsPanel.method_post_finance_efinance',
    defaultMessage: 'PostFinance e-finance',
  },
  method_prepayment: {
    id: 'PaymentsPanel.method_prepayment',
    defaultMessage: 'Prepayment',
  },
  method_przelewy24: {
    id: 'PaymentsPanel.method_przelewy24',
    defaultMessage: 'Przelewy24',
  },
  method_sepa_direct_debit: {
    id: 'PaymentsPanel.method_sepa_direct_debit',
    defaultMessage: 'SEPA Direct Debit',
  },
  method_twint: {
    id: 'PaymentsPanel.method_twint',
    defaultMessage: 'TWINT',
  },
  method_wechatpay: {
    id: 'PaymentsPanel.method_wechatpay',
    defaultMessage: 'WeChat Pay',
  },
  state_create: {
    id: 'PaymentsPanel.state_create',
    defaultMessage: 'Created',
  },
  state_pending: {
    id: 'PaymentsPanel.state_pending',
    defaultMessage: 'Pending',
  },
  state_completed: {
    id: 'PaymentsPanel.state_completed',
    defaultMessage: 'Completed',
  },
  state_partly: {
    id: 'PaymentsPanel.state_partly',
    defaultMessage: 'Partly charged',
  },
  state_canceled: {
    id: 'PaymentsPanel.state_canceled',
    defaultMessage: 'Canceled',
  },
  state_payment_review: {
    id: 'PaymentsPanel.state_payment_review',
    defaultMessage: 'Payment review',
  },
  state_chargeback: {
    id: 'PaymentsPanel.state_chargeback',
    defaultMessage: 'Chargeback',
  },
});
