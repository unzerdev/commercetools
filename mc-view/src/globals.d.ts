// mc-scripts bundles plain-CSS side-effect imports (postcss → style/extract loader);
// TypeScript only ships declarations for `*.mod.css` / `*.module.css`
// (@commercetools-frontend/application-config/client), so the plain pattern is declared here.
declare module '*.css';
