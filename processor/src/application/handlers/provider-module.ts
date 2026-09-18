import type { CustomTypeDeclaration, PaymentState, ProviderStatusInput } from '../../domain';
import type { ConfigHandler } from './config';
import type { ModificationHandler, PaymentHandler, ReturnHandler } from './payment';
import type { CustomerDirectory, IntrospectionService, MethodLogos, MethodSurface } from './read';
import type { WebhookHandler } from './webhook-handler';

/** The bundle of provider handlers the orchestration dispatches to; the composition root wires exactly one. */
export interface ProviderModule {
  /** The provider's registry key. */
  readonly key: string;

  /** The CT Payment custom type this provider needs; created idempotently in post-deploy. */
  readonly paymentCustomType: CustomTypeDeclaration;

  readonly methodLogos: MethodLogos;

  /** The single place a vendor status envelope becomes a `PaymentState`. */
  mapProviderStatus(raw: ProviderStatusInput): PaymentState;

  config: ConfigHandler;

  payment: PaymentHandler;

  modifications: ModificationHandler;

  returnLeg: ReturnHandler;

  introspection: IntrospectionService;

  surface: MethodSurface;

  /** Optional: a provider whose surface creates no customer of its own implements nothing. */
  customers?: CustomerDirectory;

  webhook: WebhookHandler;
}
