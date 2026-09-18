import { useQuery } from '@tanstack/react-query';
import { useProcessorClient } from '../use-processor-client';
import type { OrderPaymentsDto } from '../../types/payments';

/**
 * The panel's single read: one processor call per order, which costs one commercetools call for the
 * order with its payments expanded, one store-config read per distinct store key among the connector's
 * payments on it (one, for every order that is not pathological), and one the vendor call per
 * connector-owned payment - nothing per transaction, nothing per row.
 * Every field the panel shows — the summary amount book, the transaction legs, the headrooms —
 * is served from this one response, so a re-render or a second look issues no further request.
 *
 * The entry lives in the session-lifetime cache configured in `routes.tsx` (nothing expires on its
 * own), so an action keeps it coherent by invalidating this key - never by patching state locally.
 */

/** The cache key an order's panel lives under — the contract between this hook and the action mutation. */
export const orderPaymentsQueryKey = (orderId: string) =>
  ['processor', 'order-payments', orderId] as const;

export type UseOrderPaymentsResult = {
  data?: OrderPaymentsDto;
  loading: boolean;
  error?: Error;
  /**
   * A read is in flight while the panel is ALREADY on screen — the re-read every action fires, or a
   * manual retry. Distinct from `loading`, which is the first read and renders a whole-panel spinner:
   * this one means the amounts and headroom on screen are the ones the action was decided against and
   * are about to be replaced, so nothing may be started against them.
   */
  refreshing: boolean;
  /** Re-runs the read, which retries the provider details a previous read could not fetch. */
  refetch: () => void;
};

export const useOrderPayments = (orderId: string): UseOrderPaymentsResult => {
  const client = useProcessorClient();
  const query = useQuery({
    queryKey: orderPaymentsQueryKey(orderId),
    queryFn: () => client.getOrderPayments(orderId),
  });

  return {
    data: query.data,
    loading: query.isPending,
    // `isFetching` and not `isPending`: the first read is `loading`, and what this reports is a read
    // running UNDER a rendered panel, which is the window an operator could act in twice.
    refreshing: query.isFetching,
    error: query.error ?? undefined,
    refetch: () => {
      query.refetch();
    },
  };
};
