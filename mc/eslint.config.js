process.env.ENABLE_NEW_JSX_TRANSFORM = 'true';

const mcAppConfig = require('@commercetools-frontend/eslint-config-mc-app');

module.exports = [
  // The starter ships no ignores for its own build output, so `eslint .`
  // fails on the bundled `public/` artifacts after a build. Mirrors
  // .prettierignore.
  { ignores: ['public/'] },
  ...mcAppConfig,
  // NO GraphQL rules here: this app issues no GraphQL. Every commercetools read
  // and write goes through the processor's `/operations/*` endpoints over the MC
  // API Gateway, which is what keeps schema validation, encryption and the store
  // guards in one place. The starter's `*.ctp.graphql` block — and the 3 MB
  // introspection dump it validated against — matched no file in this app.
  {
    files: ['eslint.config.js'],
    rules: { 'import/extensions': 'off' },
  },
];
