import { type BasketsApi, BasketsResource } from './resources/baskets.resource';
import { type CustomersApi, CustomersResource } from './resources/customers.resource';
import { type KeypairApi, KeypairResource } from './resources/keypair.resource';
import { type PaymentsApi, PaymentsResource } from './resources/payments.resource';
import { type WebhooksApi, WebhooksResource } from './resources/webhooks.resource';
import { HttpPspTransport, type PspTransport } from './transport';

/**
 * The Unzer client: a composition of resources over the one transport. Every call takes a named request and
 * reads its answer through `responses/`, so a wire drift fails at the boundary as a typed `PspError`.
 */
export class PspClient {
  /** `GET /v1/keypair/types`: credential validation and the account's method-type catalogue. */
  public readonly keypair: KeypairApi;

  /** `/v1/webhooks`: the store's event subscriptions. */
  public readonly webhooks: WebhooksApi;

  /** `/v1/payments/*`: charge, authorize, read and the three modifications. */
  public readonly payments: PaymentsApi;

  /** `/v1/customers`: the shopper resource a charge links. */
  public readonly customers: CustomersApi;

  /** `POST /v2/baskets` and `POST /v1/metadata`: the linked resources a payment references by id. */
  public readonly baskets: BasketsApi;

  constructor(transport: PspTransport = new HttpPspTransport()) {
    this.keypair = new KeypairResource(transport);
    this.webhooks = new WebhooksResource(transport);
    this.payments = new PaymentsResource(transport);
    this.customers = new CustomersResource(transport);
    this.baskets = new BasketsResource(transport);
  }
}
