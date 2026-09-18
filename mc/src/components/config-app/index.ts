import { lazy } from 'react';

const ConfigApp = lazy(
  () => import('./config-app' /* webpackChunkName: "config-app" */)
);

export default ConfigApp;
