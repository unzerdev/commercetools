import { defineMessages } from 'react-intl';

/** Copy for the per-method settings modal (opened from a method's `Settings` action). */
export default defineMessages({
  learnMore: {
    id: 'ConfigApp.MethodSettings.learnMore',
    defaultMessage: 'Learn more',
  },
  nameLabel: {
    id: 'ConfigApp.MethodSettings.nameLabel',
    defaultMessage: 'Payment method name',
  },
  nameHint: {
    id: 'ConfigApp.MethodSettings.nameHint',
    defaultMessage: 'The Unzer payment method name on the checkout.',
  },
  descriptionLabel: {
    id: 'ConfigApp.MethodSettings.descriptionLabel',
    defaultMessage: 'Payment method description',
  },
  descriptionHint: {
    id: 'ConfigApp.MethodSettings.descriptionHint',
    defaultMessage: 'The Unzer payment method description on the checkout.',
  },
  languageSelectorLabel: {
    id: 'ConfigApp.MethodSettings.languageSelectorLabel',
    defaultMessage: 'Language for {field}',
  },
  bookingLabel: {
    id: 'ConfigApp.MethodSettings.bookingLabel',
    defaultMessage: 'Booking method',
  },
  bookingHint: {
    id: 'ConfigApp.MethodSettings.bookingHint',
    defaultMessage:
      'You can initialize the payment page to support either charge or authorize transactions.',
  },
  bookingCharge: {
    id: 'ConfigApp.MethodSettings.bookingCharge',
    defaultMessage: 'Charge',
  },
  bookingAuthorize: {
    id: 'ConfigApp.MethodSettings.bookingAuthorize',
    defaultMessage: 'Authorize',
  },
  // Money is configured PER CURRENCY: the connector converts nothing, so one amount could only ever be
  // right for one of the store's currencies.
  amountsHint: {
    id: 'ConfigApp.MethodSettings.amountsHint',
    defaultMessage:
      'Each amount is set per currency - pick the currency beside the field. A currency you leave empty has no limits and no surcharge.',
  },
  currencySelectorLabel: {
    id: 'ConfigApp.MethodSettings.currencySelectorLabel',
    defaultMessage: 'Currency for {field}',
  },
  minAmountLabel: {
    id: 'ConfigApp.MethodSettings.minAmountLabel',
    defaultMessage: 'Min order amount',
  },
  maxAmountLabel: {
    id: 'ConfigApp.MethodSettings.maxAmountLabel',
    defaultMessage: 'Max order amount',
  },
  surchargeLabel: {
    id: 'ConfigApp.MethodSettings.surchargeLabel',
    defaultMessage: 'Surcharge',
  },
  surchargeHint: {
    id: 'ConfigApp.MethodSettings.surchargeHint',
    defaultMessage: 'Specify an additional fee applied to this payment method.',
  },
  countriesLabel: {
    id: 'ConfigApp.MethodSettings.countriesLabel',
    defaultMessage: 'Restrict to specific countries',
  },
  countriesHint: {
    id: 'ConfigApp.MethodSettings.countriesHint',
    defaultMessage:
      'Select the countries where this payment method should be available.',
  },
  countriesPlaceholder: {
    id: 'ConfigApp.MethodSettings.countriesPlaceholder',
    defaultMessage: 'All countries',
  },
  // Click to Pay rides on the card method: the vendor exposes it as a second checkout affordance on the
  // same payment type, so it is a switch inside Cards rather than a method of its own.
  clickToPayLabel: {
    id: 'ConfigApp.MethodSettings.clickToPayLabel',
    defaultMessage: 'Enable Click to Pay',
  },
  clickToPayDescription: {
    id: 'ConfigApp.MethodSettings.clickToPayDescription',
    defaultMessage:
      'Offer Click to Pay alongside the card form, so returning shoppers can pay with a card they have already enrolled.',
  },
  googlePayGatewayIdLabel: {
    id: 'ConfigApp.MethodSettings.googlePayGatewayIdLabel',
    defaultMessage: 'Gateway merchant ID',
  },
  googlePayGatewayIdHint: {
    id: 'ConfigApp.MethodSettings.googlePayGatewayIdHint',
    defaultMessage:
      'Read from your Unzer account and stored with this method every time you save. If it stays empty, please contact Unzer support.',
  },
  googlePayGatewayIdPending: {
    id: 'ConfigApp.MethodSettings.googlePayGatewayIdPending',
    defaultMessage: 'Set on the next save',
  },
  googlePayMerchantIdLabel: {
    id: 'ConfigApp.MethodSettings.googlePayMerchantIdLabel',
    defaultMessage: 'Google merchant ID',
  },
  googlePayMerchantIdHint: {
    id: 'ConfigApp.MethodSettings.googlePayMerchantIdHint',
    defaultMessage:
      'From the Google Pay & Wallet Console. Until it is set, Google renders the payment sheet in test mode.',
  },
  googlePayMerchantNameLabel: {
    id: 'ConfigApp.MethodSettings.googlePayMerchantNameLabel',
    defaultMessage: 'Google merchant name',
  },
  googlePayMerchantNameHint: {
    id: 'ConfigApp.MethodSettings.googlePayMerchantNameHint',
    defaultMessage:
      'The name the shopper reads inside the Google payment sheet.',
  },
  googlePayCountryLabel: {
    id: 'ConfigApp.MethodSettings.googlePayCountryLabel',
    defaultMessage: 'Contract country',
  },
  googlePayCountryHint: {
    id: 'ConfigApp.MethodSettings.googlePayCountryHint',
    defaultMessage:
      'The countryCode must be set to the one submitted to Merchant upfront in the contract or in a separated email. Currently supported values are CH and DK. Default is DK.',
  },
  googlePayCreditCardsLabel: {
    id: 'ConfigApp.MethodSettings.googlePayCreditCardsLabel',
    defaultMessage: 'Allow credit cards',
  },
  googlePayPrepaidCardsLabel: {
    id: 'ConfigApp.MethodSettings.googlePayPrepaidCardsLabel',
    defaultMessage: 'Allow prepaid cards',
  },
  applePayLabelLabel: {
    id: 'ConfigApp.MethodSettings.applePayLabelLabel',
    defaultMessage: 'Payee name',
  },
  applePayLabelHint: {
    id: 'ConfigApp.MethodSettings.applePayLabelHint',
    defaultMessage:
      'Shown beside the total in the Apple payment sheet. Left empty, the shopper reads the store key instead.',
  },
  walletNetworksLabel: {
    id: 'ConfigApp.MethodSettings.walletNetworksLabel',
    defaultMessage: 'Card networks',
  },
  walletNetworksHint: {
    id: 'ConfigApp.MethodSettings.walletNetworksHint',
    defaultMessage:
      'The networks your Unzer account is served this method for. Deselect one only to narrow what the wallet sheet offers.',
  },
  walletButtonColorLabel: {
    id: 'ConfigApp.MethodSettings.walletButtonColorLabel',
    defaultMessage: 'Button colour',
  },
  walletButtonColorDefault: {
    id: 'ConfigApp.MethodSettings.walletButtonColorDefault',
    defaultMessage: "Google's default",
  },
  walletButtonColorBlack: {
    id: 'ConfigApp.MethodSettings.walletButtonColorBlack',
    defaultMessage: 'Black',
  },
  walletButtonColorWhite: {
    id: 'ConfigApp.MethodSettings.walletButtonColorWhite',
    defaultMessage: 'White',
  },
  walletButtonTypeLabel: {
    id: 'ConfigApp.MethodSettings.walletButtonTypeLabel',
    defaultMessage: 'Button label',
  },
  walletButtonTypeHint: {
    id: 'ConfigApp.MethodSettings.walletButtonTypeHint',
    defaultMessage: 'What Google writes on its own button.',
  },
  walletButtonType_buy: {
    id: 'ConfigApp.MethodSettings.walletButtonType_buy',
    defaultMessage: 'Buy with Google Pay',
  },
  walletButtonType_pay: {
    id: 'ConfigApp.MethodSettings.walletButtonType_pay',
    defaultMessage: 'Pay with Google Pay',
  },
  walletButtonType_checkout: {
    id: 'ConfigApp.MethodSettings.walletButtonType_checkout',
    defaultMessage: 'Check out with Google Pay',
  },
  walletButtonType_order: {
    id: 'ConfigApp.MethodSettings.walletButtonType_order',
    defaultMessage: 'Order with Google Pay',
  },
  walletButtonType_book: {
    id: 'ConfigApp.MethodSettings.walletButtonType_book',
    defaultMessage: 'Book with Google Pay',
  },
  walletButtonType_donate: {
    id: 'ConfigApp.MethodSettings.walletButtonType_donate',
    defaultMessage: 'Donate with Google Pay',
  },
  walletButtonType_subscribe: {
    id: 'ConfigApp.MethodSettings.walletButtonType_subscribe',
    defaultMessage: 'Subscribe with Google Pay',
  },
  walletButtonType_plain: {
    id: 'ConfigApp.MethodSettings.walletButtonType_plain',
    defaultMessage: 'The Google Pay mark only',
  },
  walletButtonSizeLabel: {
    id: 'ConfigApp.MethodSettings.walletButtonSizeLabel',
    defaultMessage: 'Button size',
  },
  walletButtonSizeFill: {
    id: 'ConfigApp.MethodSettings.walletButtonSizeFill',
    defaultMessage: 'Fill the container',
  },
  walletButtonSizeStatic: {
    id: 'ConfigApp.MethodSettings.walletButtonSizeStatic',
    defaultMessage: 'Fixed size',
  },
  sendBasketLabel: {
    id: 'ConfigApp.MethodSettings.sendBasketLabel',
    defaultMessage: 'Enable sending basket',
  },
  sendBasketDescription: {
    id: 'ConfigApp.MethodSettings.sendBasketDescription',
    defaultMessage:
      'If this option is enabled, the basket data will always be sent to the Unzer API. This ensures that every transaction includes complete order details, providing better transparency and enabling more accurate processing through the Unzer system.',
  },
  cancel: {
    id: 'ConfigApp.MethodSettings.cancel',
    defaultMessage: 'Cancel',
  },
  saveChanges: {
    id: 'ConfigApp.MethodSettings.saveChanges',
    defaultMessage: 'Save changes',
  },
  // The save leaves the browser (the whole method list is PUT), so the button says so while it is in
  // flight - the same wording the connection form uses.
  saving: {
    id: 'ConfigApp.MethodSettings.saving',
    defaultMessage: 'Saving…',
  },
});
