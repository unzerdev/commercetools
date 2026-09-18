import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A FRESH query cache per test, mirroring the production defaults (`entry-point.tsx`): load once,
 * serve identical requests from memory, no retries or focus refetches. Each spec creates its own
 * client so cached data never bleeds between tests; the client is returned so cache-coherence specs
 * can assert on or seed it (`setQueryData`).
 */
export const createQueryHarness = (): {
  queryClient: QueryClient;
  Wrapper: ComponentType<{ children: ReactNode }>;
} => {
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
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Wrapper };
};
