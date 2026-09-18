import type { CustomerDirectory } from '../../../application/handlers';
import type { StoreConfig } from '../../../domain';
import { CUSTOMER_REFERENCE_TAKEN_CODE, PspClient, toPspConnectionConfig } from '../client';
import type { PspConnectionConfig, UnzerCustomer } from '../client';
import { PspError } from '../errors';
import type { CustomerResolveInput } from './customer-resolve-input';
import { toUnzerCustomer } from './to-unzer-customer';

/**
 * Resolving the vendor customer a charge links. A surface-created id is the payer and is forwarded untouched;
 * otherwise the cart is mapped and created under the platform customer id as merchant reference, or written
 * onto the customer the account already holds under it.
 */
export class PspCustomerHandler implements CustomerDirectory {
  constructor(private readonly unzer: Pick<PspClient, 'customers'> = new PspClient()) {}

  /** The vendor customer held under `reference`, for the surface to update rather than re-create; best-effort. */
  async heldCustomerId(cfg: StoreConfig, reference: string): Promise<string | undefined> {
    if (!reference) {
      return undefined;
    }
    try {
      const held = await this.unzer.customers.fetch(toPspConnectionConfig(cfg), reference);
      return held?.id ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** The vendor customer id to link, or `undefined` when the cart carries no first and last name. */
  async resolveCustomerId(cfg: PspConnectionConfig, input: CustomerResolveInput): Promise<string | undefined> {
    if (input.candidateCustomerId) {
      return input.candidateCustomerId;
    }

    const desired = toUnzerCustomer(input);
    if (!desired) {
      return undefined;
    }

    return this.createOrUpdate(cfg, desired);
  }

  /**
   * Update the customer held under the merchant reference unconditionally (a comparison goes stale, an
   * unconditional write cannot), or create it; a create that loses the race to `API.410.200.010` recovers by
   * reading the winner and updating it.
   */
  private async createOrUpdate(cfg: PspConnectionConfig, desired: UnzerCustomer): Promise<string> {
    if (desired.customerId) {
      const held = await this.unzer.customers.fetch(cfg, desired.customerId);
      if (held?.id) {
        await this.unzer.customers.update(cfg, held.id, toUpdateBody(desired, held.id));
        return held.id;
      }
    }

    try {
      return await this.unzer.customers.create(cfg, desired);
    } catch (e) {
      const collided = e instanceof PspError && e.hasVendorCode(CUSTOMER_REFERENCE_TAKEN_CODE);
      if (!collided || !desired.customerId) {
        throw e;
      }
      const held = await this.unzer.customers.fetch(cfg, desired.customerId);
      if (!held?.id) {
        throw e;
      }
      await this.unzer.customers.update(cfg, held.id, toUpdateBody(desired, held.id));
      return held.id;
    }
  }
}

/** The update body: the vendor's PUT merges, so an absent company is sent as `''` to clear a stale one. */
function toUpdateBody(desired: UnzerCustomer, id: string): UnzerCustomer {
  return {
    ...desired,
    id,
    company: desired.company ?? '',
    ...(desired.billingAddress
      ? { billingAddress: { ...desired.billingAddress, company: desired.billingAddress.company ?? '' } }
      : {}),
    ...(desired.shippingAddress
      ? { shippingAddress: { ...desired.shippingAddress, company: desired.shippingAddress.company ?? '' } }
      : {}),
  };
}
