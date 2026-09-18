import type { StoreConfig } from '../../../domain';

/** Names the vendor customer a shopper already has, so the checkout surface updates it instead of creating a second one. */
export interface CustomerDirectory {
  /** Best-effort: answers `undefined` for an unknown reference or an ordinary vendor refusal, never throws. */
  heldCustomerId(cfg: StoreConfig, reference: string): Promise<string | undefined>;
}
