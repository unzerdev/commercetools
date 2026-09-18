process.env.ENABLE_NEW_JSX_TRANSFORM = 'true';

const mcAppConfig = require('@commercetools-frontend/eslint-config-mc-app');

module.exports = [
  // The starter ships no ignores for its own build output, so `eslint .`
  // fails on the bundled `public/` artifacts after a build. Mirrors
  // .prettierignore.
  { ignores: ['public/'] },
  ...mcAppConfig,
  {
    files: ['eslint.config.js'],
    rules: { 'import/extensions': 'off' },
  },
];
