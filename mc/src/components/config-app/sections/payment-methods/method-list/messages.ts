import { defineMessages } from 'react-intl';

export default defineMessages({
  heading: {
    id: 'ConfigApp.PaymentMethods.heading',
    defaultMessage: 'Payment methods',
  },
  description: {
    id: 'ConfigApp.PaymentMethods.description',
    defaultMessage:
      'Here is the list of available payment methods for your merchant account. You can enable a payment method in your store by clicking on the toggle button.',
  },
  noMethods: {
    id: 'ConfigApp.PaymentMethods.noMethods',
    defaultMessage:
      'No payment methods are available yet. They appear once the store is connected to Unzer.',
  },
  settings: {
    id: 'ConfigApp.PaymentMethods.settings',
    defaultMessage: 'Settings',
  },
  learnMore: {
    id: 'ConfigApp.PaymentMethods.learnMore',
    defaultMessage: 'Learn more',
  },
  enableMethod: {
    id: 'ConfigApp.PaymentMethods.enableMethod',
    defaultMessage: 'Enable {method}',
  },
});
