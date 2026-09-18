import { defineMessages } from 'react-intl';

export default defineMessages({
  title: {
    id: 'ConfigApp.title',
    defaultMessage: 'Unzer Payments',
  },
  tabConnection: {
    id: 'ConfigApp.tabConnection',
    defaultMessage: 'Connection',
  },
  tabPaymentMethods: {
    id: 'ConfigApp.tabPaymentMethods',
    defaultMessage: 'Payment methods',
  },
  storeSelectorLabel: {
    id: 'ConfigApp.storeSelectorLabel',
    defaultMessage: 'Store',
  },
  storeSelectMenuTitle: {
    id: 'ConfigApp.storeSelectMenuTitle',
    defaultMessage: 'Select store',
  },
  defaultScopeLabel: {
    id: 'ConfigApp.defaultScopeLabel',
    defaultMessage: 'Default (all stores)',
  },
  storesEmpty: {
    id: 'ConfigApp.storesEmpty',
    defaultMessage:
      'This project has no stores with a key. Create a store first, then configure it here.',
  },
  storesError: {
    id: 'ConfigApp.storesError',
    defaultMessage:
      'Could not load the project stores. Refresh the page to try again.',
  },
  configLoadError: {
    id: 'ConfigApp.configLoadError',
    defaultMessage: 'Could not load this store’s configuration.',
  },
  saveSuccess: {
    id: 'ConfigApp.saveSuccess',
    defaultMessage: 'Connection saved.',
  },
  saveError: {
    id: 'ConfigApp.saveError',
    defaultMessage:
      'Could not connect to Unzer. Check that the public and private key are correct for the selected environment, then try again.',
  },
  disconnectSuccess: {
    id: 'ConfigApp.disconnectSuccess',
    defaultMessage: 'Environment disconnected.',
  },
  disconnectError: {
    id: 'ConfigApp.disconnectError',
    defaultMessage: 'Could not disconnect this environment. Try again.',
  },
  methodsSaveSuccess: {
    id: 'ConfigApp.methodsSaveSuccess',
    defaultMessage: 'Payment methods saved.',
  },
  methodsSaveError: {
    id: 'ConfigApp.methodsSaveError',
    defaultMessage: 'Could not save the payment methods.',
  },
  processorUnreachable: {
    id: 'ConfigApp.processorUnreachable',
    defaultMessage:
      'Something went wrong reaching the payment connector. (HTTP {status})',
  },
  processorOffline: {
    id: 'ConfigApp.processorOffline',
    defaultMessage:
      'The payment connector cannot be reached. Check your network connection and try again.',
  },
});
