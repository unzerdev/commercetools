import type { PspConnectionConfig } from '../connection';
import type { PspTransport } from '../transport';
import { createdResourceId } from '../responses/payments';

/** The vendor's V2 basket model (keyed on `totalValueGross`), linked to a payment by id. */
export interface UnzerBasket {
  totalValueGross: string;
  currencyCode: string;
  orderId: string;
  basketItems: UnzerBasketItem[];
}

/** One basket line; `vat` is mandatory on the wire even though the published schema does not say so. */
export interface UnzerBasketItem {
  basketItemReferenceId: string;
  title: string;
  quantity: number;
  amountPerUnitGross: string;
  amountDiscountPerUnitGross: string;
  vat: number;
  type?: string;
}

/** The metadata resource: a free-form bag identifying the integration to Unzer support. */
export type UnzerMetadata = Record<string, string>;

/** The baskets and metadata resource surface a test can stand in for. */
export interface BasketsApi {
  create(cfg: PspConnectionConfig, basket: UnzerBasket): Promise<string>;
  createMetadata(cfg: PspConnectionConfig, metadata: UnzerMetadata): Promise<string>;
}

export class BasketsResource implements BasketsApi {
  constructor(private readonly transport: PspTransport) {}

  /** `POST /v2/baskets`; the id links as `resources.basketId`. */
  public async create(cfg: PspConnectionConfig, basket: UnzerBasket): Promise<string> {
    return createdResourceId(
      await this.transport.send(cfg, { method: 'POST', path: '/v2/baskets', body: basket }),
      'basket',
    );
  }

  /** `POST /v1/metadata`; the id links as `resources.metadataId`. */
  public async createMetadata(cfg: PspConnectionConfig, metadata: UnzerMetadata): Promise<string> {
    return createdResourceId(
      await this.transport.send(cfg, { method: 'POST', path: '/v1/metadata', body: metadata }),
      'metadata',
    );
  }
}
