import type { IntrospectionService } from '../../../application/handlers';
import type {
  AvailableMethod,
  ConnectionTestResult,
  PaymentComponent,
  ProviderPaymentDetails,
  StatusCheck,
  StoreConfig,
} from '../../../domain';
import { PspClient, toPspConnectionConfig } from '../client';
import { toPaymentDetails } from '../mapping';
import {
  COMPOSITE_COMPONENT_TYPE,
  inDisplayOrder,
  isOfferableMethod,
  supportsCharge,
  supportsTwoStep,
  toSurfaceCardNetworks,
} from '../methods';
import { TtlMemo } from '../ttl-memo';
import { probeKeypair } from './keypair-probe';

/** The catalogue memo window: a merchant sees a newly available method within this span. */
const CATALOGUE_TTL_MS = 120_000;

/**
 * The read-only provider surface: the keypair probe as health check and connection test, the memoized method
 * catalogue, the single payment read the panel renders, and the static component advertisement.
 */
export class PspIntrospectionService implements IntrospectionService {
  /** The catalogue per `(storeKey, mode)`; only this static reference read is cached, the probes stay live. */
  private readonly catalogueMemo = new TtlMemo<AvailableMethod[]>(CATALOGUE_TTL_MS);

  constructor(private readonly unzer: Pick<PspClient, 'keypair' | 'payments'> = new PspClient()) {}

  /** Vendor connectivity as one check, from the same probe the merchant test button runs. */
  async statusChecks(cfg: StoreConfig): Promise<StatusCheck[]> {
    const probe = await probeKeypair(this.unzer, cfg);
    return [
      {
        name: 'psp-connectivity',
        status: probe.success ? 'UP' : 'DOWN',
        message: probe.success ? 'PSP connectivity OK' : (probe.message ?? 'PSP connectivity failed'),
      },
    ];
  }

  /**
   * The catalogue for the store's environment: the keypair's code universe decorated with the static
   * transaction support and the vendor's coverage, minus every code this connector cannot offer, in display
   * order. Only a success is cached.
   */
  async availableMethods(cfg: StoreConfig): Promise<AvailableMethod[]> {
    const key = `${cfg.storeKey}:${cfg.mode}`;
    const cached = this.catalogueMemo.get(key);
    if (cached) {
      return cached;
    }
    const { availableMethods, methodSupport } = await this.unzer.keypair.validate(toPspConnectionConfig(cfg));
    const support = new Map(methodSupport.map((entry) => [entry.code, entry]));
    const value = inDisplayOrder(
      availableMethods
        .filter((code) => isOfferableMethod(code))
        .map((code) => ({
          code,
          supportsAuthorize: supportsTwoStep(code),
          supportsCharge: supportsCharge(code),
          countries: support.get(code)?.countries ?? [],
          currencies: support.get(code)?.currencies ?? [],
          customerTypes: support.get(code)?.customerTypes ?? [],
          cardNetworks: toSurfaceCardNetworks(code, support.get(code)?.brands ?? []),
          ...(support.get(code)?.channel ? { channel: support.get(code)?.channel } : {}),
        })),
    );
    this.catalogueMemo.set(key, value);
    return value;
  }

  /** The merchant test button: the keypair probe, with a pair mismatch attributed to the public-key field. */
  async testConnection(cfg: StoreConfig): Promise<ConnectionTestResult> {
    return probeKeypair(this.unzer, cfg);
  }

  /** Exactly one `GET /v1/payments/{id}`; a failure leaves as the typed error so the caller degrades one payment. */
  async paymentDetails(cfg: StoreConfig, providerPaymentId: string): Promise<ProviderPaymentDetails> {
    const payment = await this.unzer.payments.get(toPspConnectionConfig(cfg), providerPaymentId);
    return toPaymentDetails(payment);
  }

  /** ONE custom component, `unzer`: the enabler renders every method the Merchant Center app enabled for the store and mounts the chosen one under it. */
  supportedComponents(): PaymentComponent[] {
    return [{ type: COMPOSITE_COMPONENT_TYPE }];
  }

  /** The same list under Checkout's drop-in type, for a merchant who prefers that integration mode; one of the two is active at a time. */
  supportedDropins(): PaymentComponent[] {
    return [{ type: 'embedded' }];
  }
}
