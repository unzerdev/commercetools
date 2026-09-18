import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ProcessorError, useProcessorClient } from '../use-processor-client';
import type {
  PaymentIntentActionDto,
  PaymentIntentResponseDto,
} from '../../types/payments';
import { orderPaymentsQueryKey } from './use-order-payments';

/**
 * A merchant-initiated capture / refund / cancel — and the panel's reading of the three answers the
 * processor can give. The processor is the only source of truth for what an action did to the payment
 * (it writes the commercetools Transaction and may be corrected by the webhook afterwards), so the panel
 * never patches the cached amounts: it invalidates the order's entry and re-reads.
 *
 * - `approved` — the vendor performed it. The leg is `Success`, and the re-read shows the moved money.
 * - `received` — the vendor ACCEPTED it but has not settled it. The leg stands `Pending`: not a failure,
 *   nothing for the operator to fix and nothing to re-send, so it is a success here and the dialog closes
 *   like any accepted action. The re-read is what states it — `Paid`/`Refunded` count settled money and
 *   do NOT move, the headroom counts the pending leg as spent (so the same operation cannot be sent
 *   twice), and the transaction history carries the leg as pending. A notification would say nothing the
 *   refreshed payment does not, and it would have to outlive the dialog to say it.
 * - `rejected` — the vendor REFUSED it. It arrives as an ordinary 200 (the vendor declines in the body,
 *   not in the status), which react-query would otherwise call a success: the dialog would close, no
 *   error would render, and the operator would read a refusal as an approval. So it is raised as the
 *   failure it is, worded by the panel's catalogue — the processor sends no message with this one.
 *
 * EVERY settled attempt re-reads, answered or not. The processor may have written to the payment on any
 * of them: a refusal leaves a `Failure` leg (in both the shapes the vendor refuses in — the 200 body above
 * and a thrown vendor 4xx, which the processor releases identically), an ambiguous outcome leaves a
 * `Pending` leg with the headroom shut, and even a transport failure can be a lost RESPONSE to an
 * operation the processor performed. The panel cannot tell those apart from here — only the processor
 * knows what it wrote — so it asks it, and shows what it answers.
 */

export type PaymentIntentVariables = {
  paymentId: string;
  action: PaymentIntentActionDto;
};

export const usePaymentIntent = (orderId: string) => {
  const client = useProcessorClient();
  const queryClient = useQueryClient();

  return useMutation<PaymentIntentResponseDto, Error, PaymentIntentVariables>({
    mutationFn: async ({ paymentId, action }) => {
      const result = await client.submitPaymentIntent(paymentId, {
        actions: [action],
      });
      if (result.outcome === 'rejected') {
        throw new ProcessorError(
          'The payment provider refused the operation.',
          'PaymentsPanel.operationRefused'
        );
      }
      return result;
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: orderPaymentsQueryKey(orderId),
      }),
  });
};
