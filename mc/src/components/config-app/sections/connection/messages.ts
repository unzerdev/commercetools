import { defineMessages } from 'react-intl';

export default defineMessages({
  marketingHeading: {
    id: 'ConfigApp.Connection.marketingHeading',
    defaultMessage:
      'UnzerOne: one platform for all channels and the ideal customer experience.',
  },
  marketingBody: {
    id: 'ConfigApp.Connection.marketingBody',
    defaultMessage:
      'Make sure that you’re logged in to the <portal>merchant portal</portal> because you need to copy several settings from there to fill in the information below. If you don’t have an account, <contact>contact us here</contact>.',
  },
  environmentLabel: {
    id: 'ConfigApp.Connection.environmentLabel',
    defaultMessage: 'Environment',
  },
  environmentSandbox: {
    id: 'ConfigApp.Connection.environmentSandbox',
    defaultMessage: 'Sandbox',
  },
  environmentLive: {
    id: 'ConfigApp.Connection.environmentLive',
    defaultMessage: 'Live',
  },
  cardTitle: {
    id: 'ConfigApp.Connection.cardTitle',
    defaultMessage: 'Credentials',
  },
  cardDescription: {
    id: 'ConfigApp.Connection.cardDescription',
    defaultMessage:
      'You can find your API credentials in the <portal>merchant portal</portal>.',
  },
  publicKeyLabel: {
    id: 'ConfigApp.Connection.publicKeyLabel',
    defaultMessage: 'Public key',
  },
  publicKeyPlaceholder: {
    id: 'ConfigApp.Connection.publicKeyPlaceholder',
    defaultMessage: 'Enter public key ({prefix}…)',
  },
  privateKeyLabel: {
    id: 'ConfigApp.Connection.privateKeyLabel',
    defaultMessage: 'Private key',
  },
  privateKeyPlaceholder: {
    id: 'ConfigApp.Connection.privateKeyPlaceholder',
    defaultMessage: 'Enter private key ({prefix}…)',
  },
  showPrivateKey: {
    id: 'ConfigApp.Connection.showPrivateKey',
    defaultMessage: 'Show private key',
  },
  hidePrivateKey: {
    id: 'ConfigApp.Connection.hidePrivateKey',
    defaultMessage: 'Hide private key',
  },
  connect: {
    id: 'ConfigApp.Connection.connect',
    defaultMessage: 'Connect',
  },
  saveChanges: {
    id: 'ConfigApp.Connection.saveChanges',
    defaultMessage: 'Save changes',
  },
  keyPrefixError: {
    id: 'ConfigApp.Connection.keyPrefixError',
    defaultMessage:
      'The {field} for the {env} environment must start with “{prefix}”.',
  },
  saving: {
    id: 'ConfigApp.Connection.saving',
    defaultMessage: 'Saving…',
  },
  connecting: {
    id: 'ConfigApp.Connection.connecting',
    defaultMessage: 'Connecting…',
  },
  disconnect: {
    id: 'ConfigApp.Connection.disconnect',
    defaultMessage: 'Disconnect',
  },
  disconnecting: {
    id: 'ConfigApp.Connection.disconnecting',
    defaultMessage: 'Disconnecting…',
  },
  needHelp: {
    id: 'ConfigApp.Connection.needHelp',
    defaultMessage: 'Need help?',
  },
  rotationConfirmTitle: {
    id: 'ConfigApp.Connection.rotationConfirmTitle',
    defaultMessage: 'Connect with different keys?',
  },
  rotationConfirmBody: {
    id: 'ConfigApp.Connection.rotationConfirmBody',
    defaultMessage:
      'These API keys belong to a different Unzer account. If you continue, this environment will be disconnected from the currently connected account.',
  },
  rotationConfirmWarning: {
    id: 'ConfigApp.Connection.rotationConfirmWarning',
    defaultMessage: 'All existing configuration will be deleted.',
  },
  rotationConfirmButton: {
    id: 'ConfigApp.Connection.rotationConfirmButton',
    defaultMessage: 'Reconnect',
  },
  cancel: {
    id: 'ConfigApp.Connection.cancel',
    defaultMessage: 'Cancel',
  },
  disconnectConfirmTitle: {
    id: 'ConfigApp.Connection.disconnectConfirmTitle',
    defaultMessage: 'Disconnect account',
  },
  disconnectConfirmBody: {
    id: 'ConfigApp.Connection.disconnectConfirmBody',
    defaultMessage:
      'Disconnecting removes everything saved for this environment, including its payment method settings. You can reconnect at any time.',
  },
  disconnectConfirmButton: {
    id: 'ConfigApp.Connection.disconnectConfirmButton',
    defaultMessage: 'Disconnect',
  },
  rightHeading: {
    id: 'ConfigApp.Connection.rightHeading',
    defaultMessage: 'All payment methods, 160 countries, all currencies',
  },
  rightBody: {
    id: 'ConfigApp.Connection.rightBody',
    defaultMessage:
      'Attract shoppers from across the globe. Allow them to choose from 200 national and international payment methods. Whether in your online shop or your business. Regardless of currency. All easy and affordable for you.',
  },
});
