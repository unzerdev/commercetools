import { PspError } from '../../errors';
import type { PspConnectionConfig } from '../connection';
import type { PspTransport } from '../transport';
import { createdResourceId } from '../responses/payments';

/** A postal address on a customer; `name` is the addressee's full name. */
export interface UnzerAddress {
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  state?: string;
  company?: string;
}

/** Where the goods go, a risk signal the secured and paylater methods read. */
export type UnzerShippingType =
  'equals-billing' | 'different-address' | 'branch-pickup' | 'post-office-pickup' | 'pack-station';

export interface UnzerShippingAddress extends UnzerAddress {
  shippingType?: UnzerShippingType;
}

/** Company details on a B2B customer. */
export interface UnzerCompanyInfo {
  companyType?: string;
  registrationType?: string;
  function?: string;
  commercialSector?: string;
  owner?: { firstname?: string; lastname?: string; birthdate?: string };
}

/** The customer resource; `customerId` is the merchant's own reference, not the vendor resource id. */
export interface UnzerCustomer {
  id?: string;
  firstname: string;
  lastname: string;
  salutation?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  language?: string;
  company?: string;
  birthDate?: string;
  customerId?: string;
  billingAddress?: UnzerAddress;
  shippingAddress?: UnzerShippingAddress;
  companyInfo?: UnzerCompanyInfo;
}

/** The vendor codes meaning "this account does not hold that customer". */
const CUSTOMER_ABSENT_CODES: ReadonlySet<string> = new Set(['API.410.100.100', 'API.500.100.100']);

/** The vendor code for "a customer with that merchant reference already exists". */
export const CUSTOMER_REFERENCE_TAKEN_CODE = 'API.410.200.010';

/** The customers resource surface a test can stand in for. */
export interface CustomersApi {
  fetch(cfg: PspConnectionConfig, customerId: string): Promise<UnzerCustomer | null>;
  create(cfg: PspConnectionConfig, customer: UnzerCustomer): Promise<string>;
  update(cfg: PspConnectionConfig, customerId: string, customer: UnzerCustomer): Promise<void>;
}

export class CustomersResource implements CustomersApi {
  constructor(private readonly transport: PspTransport) {}

  /** `GET /v1/customers/{id}` by resource id or merchant reference; the two "absent" codes resolve to `null`. */
  public async fetch(cfg: PspConnectionConfig, customerId: string): Promise<UnzerCustomer | null> {
    try {
      return (await this.transport.send(cfg, {
        method: 'GET',
        path: `/v1/customers/${encodeURIComponent(customerId)}`,
      })) as UnzerCustomer;
    } catch (e) {
      if (e instanceof PspError && e.vendorErrors.some((item) => item.code && CUSTOMER_ABSENT_CODES.has(item.code))) {
        return null;
      }
      throw e;
    }
  }

  /** `POST /v1/customers`; the id links as `resources.customerId`. */
  public async create(cfg: PspConnectionConfig, customer: UnzerCustomer): Promise<string> {
    return createdResourceId(
      await this.transport.send(cfg, { method: 'POST', path: '/v1/customers', body: customer }),
      'customer',
    );
  }

  /** `PUT /v1/customers/{id}`, a merge on the vendor side. */
  public async update(cfg: PspConnectionConfig, customerId: string, customer: UnzerCustomer): Promise<void> {
    await this.transport.send(cfg, {
      method: 'PUT',
      path: `/v1/customers/${encodeURIComponent(customerId)}`,
      body: customer,
    });
  }
}
