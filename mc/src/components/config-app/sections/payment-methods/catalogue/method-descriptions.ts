import { defineMessages, type MessageDescriptor } from 'react-intl';

/**
 * Unzer's own description of each payment-method type, one translatable message per code.
 *
 * This is what the settings modal shows ABOVE the fields, to say what the method is. They are messages
 * rather than fixed strings because the operator reads this screen in their Merchant Center language, and
 * "what is this payment method" is exactly the sentence that has to arrive in it.
 *
 * It is NOT a default for the merchant's own description: that field seeds itself from
 * `default-method-text` and travels to the shopper, while this text describes the method type and reads
 * the same in every environment (see `methodVendorDescription`).
 *
 * The English text is Unzer's, from the payment-method documentation.
 */
const descriptions = defineMessages({
  alipay: {
    id: 'ConfigApp.MethodDescription.alipay',
    defaultMessage:
      'Alipay, the payment method from China’s Alibaba, is the most used online payment method in China.',
  },
  applepay: {
    id: 'ConfigApp.MethodDescription.applepay',
    defaultMessage:
      'Apple Pay is a mobile wallet solution available to all users of Apple devices.',
  },
  bancontact: {
    id: 'ConfigApp.MethodDescription.bancontact',
    defaultMessage:
      'Bancontact is the most popular online payment method in Belgium, with over 15 million cards in circulation.',
  },
  card: {
    id: 'ConfigApp.MethodDescription.card',
    defaultMessage:
      'Cards can be differentiated in credit and debit cards. In most cases they are issued by banks (issuers) in cooperation with card organizations (schemes) such as Mastercard, VISA, Diners, or American Express.',
  },
  eps: {
    id: 'ConfigApp.MethodDescription.eps',
    defaultMessage:
      'Electronic Payment Standard (EPS) is a popular online payment method available in Austria.',
  },
  googlepay: {
    id: 'ConfigApp.MethodDescription.googlepay',
    defaultMessage:
      'Google Pay is a mobile wallet solution available to all the customers who have a Google account.',
  },
  ideal: {
    id: 'ConfigApp.MethodDescription.ideal',
    defaultMessage:
      'iDEAL | Wero is one of the most popular online payment methods in the Netherlands. It generates a SEPA Credit Transfer from within the consumer’s trusted online banking portal.',
  },
  klarna: {
    id: 'ConfigApp.MethodDescription.klarna',
    defaultMessage:
      'Klarna is a payment method that provides an easy to use pay later payment option.',
  },
  'openbanking-pis': {
    id: 'ConfigApp.MethodDescription.openbankingPis',
    defaultMessage:
      'Direct Bank Transfer is a payment method based on the payment initiation service. It is based on open banking technology and enables the customer to securely log into their bank account using their standard credentials and method to initiate a direct payment.',
  },
  'paylater-direct-debit': {
    id: 'ConfigApp.MethodDescription.paylaterDirectDebit',
    defaultMessage:
      'Direct Debit is a part of our Buy Now, Pay Later (BNPL) offering and it’s a convenient payment option. This payment option offers customers an easy and secure way to shop online or in-store without having to manually perform payments.',
  },
  'paylater-installment': {
    id: 'ConfigApp.MethodDescription.paylaterInstallment',
    defaultMessage:
      'Unzer Installment is a part of our Buy Now, Pay Later (BNPL) offering and it’s a very convenient payment option.',
  },
  'paylater-invoice': {
    id: 'ConfigApp.MethodDescription.paylaterInvoice',
    defaultMessage:
      'Unzer Invoice is a part of our Buy Now, Pay Later (BNPL) offering and it’s a convenient payment option.',
  },
  paypal: {
    id: 'ConfigApp.MethodDescription.paypal',
    defaultMessage:
      'PayPal is one of the most widely used online wallets, letting customers pay with a balance, bank account or card without sharing those details with the shop.',
  },
  payu: {
    id: 'ConfigApp.MethodDescription.payu',
    defaultMessage:
      'PayU is an online bank transfer. It is one of the most popular payment methods amongst Polish consumers.',
  },
  'post-finance-card': {
    id: 'ConfigApp.MethodDescription.postFinanceCard',
    defaultMessage:
      'PostFinance is an online direct payment method used by the Swiss customers for online payments. The currency is Swiss Franc (CHF).',
  },
  'post-finance-efinance': {
    id: 'ConfigApp.MethodDescription.postFinanceEfinance',
    defaultMessage:
      'PostFinance is an online direct payment method used by the Swiss customers for online payments. The transaction currency is Swiss Franc (CHF).',
  },
  prepayment: {
    id: 'ConfigApp.MethodDescription.prepayment',
    defaultMessage:
      'Prepayment is a safe and convenient payment method for merchants.',
  },
  przelewy24: {
    id: 'ConfigApp.MethodDescription.przelewy24',
    defaultMessage:
      'Przelewy24 (P24) is one of the most popular online payment methods available in Poland.',
  },
  'sepa-direct-debit': {
    id: 'ConfigApp.MethodDescription.sepaDirectDebit',
    defaultMessage:
      'SEPA Direct Debit is a payment method available in the European SEPA region and based on the EU SEPA rule book.',
  },
  twint: {
    id: 'ConfigApp.MethodDescription.twint',
    defaultMessage:
      'With TWINT, you can make convenient and secure payments with your smartphone - at the cash register in a supermarket, in an online shop, when shopping at a farm shop, on public transport, when parking, or when transferring money to your friends.',
  },
  wechatpay: {
    id: 'ConfigApp.MethodDescription.wechatpay',
    defaultMessage:
      'WeChat Pay is a Chinese payment method tied to the most popular messaging service in China.',
  },
  wero: {
    id: 'ConfigApp.MethodDescription.wero',
    defaultMessage:
      'Wero is the unified European payment solution that enables convenient and secure instant payments across Europe using just your smartphone. Whether you’re making peer-to-peer transfers with a phone number, shopping online, or making in-store payments with QR codes, Wero provides a seamless payment experience.',
  },
});

export default descriptions;

/** Unzer's description of a method type, or `undefined` for a code this catalogue does not know. */
export const unzerMethodDescription = (
  code: string
): MessageDescriptor | undefined =>
  (descriptions as Record<string, MessageDescriptor>)[code.toLowerCase()];
