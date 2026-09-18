import { useCustomViewContext } from '@commercetools-frontend/application-shell-connectors';

/**
 * The order the panel is scoped to. A Custom View receives no route params: the only handle on the
 * host page is `hostUrl` — the Merchant Center order-details URL the panel is embedded in
 * (`…/<projectKey>/orders/<orderId>/payments`) — so the order id is read from that path.
 */

const ORDER_ID_IN_PATH = /\/orders\/([^/?#]+)/;

/** `undefined` when the host page is not an order-details URL — the panel then has nothing to render. */
export const orderIdFromHostUrl = (
  hostUrl: string | undefined
): string | undefined => {
  const match = hostUrl?.match(ORDER_ID_IN_PATH);
  return match ? decodeURIComponent(match[1]) : undefined;
};

export const useOrderId = (): string | undefined =>
  useCustomViewContext((context) => orderIdFromHostUrl(context.hostUrl));
