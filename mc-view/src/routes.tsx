import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLocaleMessages from './components/data-locale-messages';
import PaymentsPanel from './components/payments-panel';

/**
 * One session-lifetime cache for every processor read: the panel loads once and every identical
 * request afterwards is served from memory (StrictMode's dev double-mount coalesces into a single
 * network call). Nothing expires or refetches on its own — a merchant action keeps the cache coherent
 * by invalidating the order's entry, so `retry`/focus refetches stay off and errors surface at once.
 */
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

const ApplicationRoutes = () => {
  return (
    <DataLocaleMessages>
      <QueryClientProvider client={queryClient}>
        <PaymentsPanel />
      </QueryClientProvider>
    </DataLocaleMessages>
  );
};
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
