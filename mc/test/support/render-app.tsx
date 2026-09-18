/**
 * Screen-level render helper: the app's routes inside the real MC ApplicationShell (plus Redux where the
 * spec needs it), composed exactly as `entry-point.tsx` composes production - same QueryClient defaults,
 * a fresh client per render so cached data cannot bleed between tests.
 *
 * Lives under `test/` because it is TEST code: it used to sit in `src/test-utils`, where nothing in the
 * app imported it and it shipped in the production source tree.
 */

import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApolloClient } from '@commercetools-frontend/application-shell';
import {
  renderApp,
  renderAppWithRedux,
  type TRenderAppOptions,
  type TRenderAppWithReduxOptions,
} from '@commercetools-frontend/application-shell/test-utils';
import { entryPointUriPath } from '../../src/constants';
import ApplicationRoutes from '../../src/routes';

const mergeWithDefaultOptions = (
  options: Partial<TRenderAppOptions> | Partial<TRenderAppWithReduxOptions> = {}
): Partial<TRenderAppOptions> | Partial<TRenderAppWithReduxOptions> => ({
  ...options,
  environment: {
    ...(options.environment || {}),
    entryPointUriPath,
  },
  apolloClient: createApolloClient(),
});

// Mirrors the production composition (`entry-point.tsx`): the routes always render under a
// QueryClientProvider with the same cache-first defaults. A FRESH client per render keeps cached
// query data from bleeding between tests.
const withQueryClient = (ui: ReactElement): ReactElement => (
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
            gcTime: Infinity,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      })
    }
  >
    {ui}
  </QueryClientProvider>
);

const renderApplication = (
  ui: ReactElement,
  options: Partial<TRenderAppOptions>
) => renderApp(withQueryClient(ui), mergeWithDefaultOptions(options));

const renderApplicationWithRedux = (
  ui: ReactElement,
  options: Partial<TRenderAppWithReduxOptions>
) => renderAppWithRedux(withQueryClient(ui), mergeWithDefaultOptions(options));

const renderApplicationWithRoutes = (options: Partial<TRenderAppOptions>) =>
  renderApplication(<ApplicationRoutes />, options);

const renderApplicationWithRoutesAndRedux = (
  options: Partial<TRenderAppWithReduxOptions>
) => renderApplicationWithRedux(<ApplicationRoutes />, options);

export {
  renderApplication,
  renderApplicationWithRedux,
  renderApplicationWithRoutes,
  renderApplicationWithRoutesAndRedux,
};
