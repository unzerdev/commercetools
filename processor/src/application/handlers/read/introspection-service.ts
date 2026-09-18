import type {
  AvailableMethod,
  ConnectionTestResult,
  PaymentComponent,
  ProviderPaymentDetails,
  StatusCheck,
  StoreConfig,
} from '../../../domain';

/** The provider's read surface: health, the credential probe, the method catalogue and the single-payment read. */
export interface IntrospectionService {
  /** Must include a vendor-connectivity check. */
  statusChecks(cfg: StoreConfig): Promise<StatusCheck[]>;

  /** The method-type codes the account may serve, with their capabilities; static enough to memoize briefly. */
  availableMethods(cfg: StoreConfig): Promise<AvailableMethod[]>;

  /** Secret-free live credential probe. */
  testConnection(cfg: StoreConfig): Promise<ConnectionTestResult>;

  /** One payment as the provider knows it. */
  paymentDetails(cfg: StoreConfig, providerPaymentId: string): Promise<ProviderPaymentDetails>;

  supportedComponents(): PaymentComponent[];

  supportedDropins(): PaymentComponent[];
}
