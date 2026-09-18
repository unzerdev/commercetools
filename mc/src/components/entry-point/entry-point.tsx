import { lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApplicationShell,
  setupGlobalErrorListener,
} from '@commercetools-frontend/application-shell';
import type { ApplicationWindow } from '@commercetools-frontend/constants';
import loadMessages from '../../load-messages';

declare let window: ApplicationWindow;

// Here we split up the main (app) bundle with the actual application business logic.
// Splitting by route is usually recommended and you can potentially have a splitting
// point for each route. More info at https://reactjs.org/docs/code-splitting.html
const AsyncApplicationRoutes = lazy(
  () => import('../../routes' /* webpackChunkName: "routes" */)
);

// Ensure to setup the global error listener before any React component renders
// in order to catch possible errors on rendering/mounting.
setupGlobalErrorListener();

// One session-lifetime cache for every processor read: a query loads once and every identical
// request afterwards is served from memory (StrictMode's dev double-mount coalesces into a single
// network call). Nothing expires or refetches on its own — mutations keep the config entry coherent
// by writing the server response back into the cache (see `ConfigForm`), so `retry`/focus refetches
// stay off and errors surface immediately.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const EntryPoint = () => (
  <ApplicationShell
    enableReactStrictMode
    environment={window.app}
    applicationMessages={loadMessages}
  >
    <QueryClientProvider client={queryClient}>
      <AsyncApplicationRoutes />
    </QueryClientProvider>
  </ApplicationShell>
);
EntryPoint.displayName = 'EntryPoint';

export default EntryPoint;
