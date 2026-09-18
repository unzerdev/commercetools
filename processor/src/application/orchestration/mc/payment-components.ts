import type { SupportedComponents } from '../../../domain';
import type { OrchestrationCtx, OrchestrationDeps } from '../shared';

/** `GET /operations/payment-components`: the provider's static components and dropins. */
export async function getSupportedPaymentComponents(
  _ctx: OrchestrationCtx,
  deps: OrchestrationDeps,
): Promise<SupportedComponents> {
  return {
    dropins: deps.provider.introspection.supportedDropins().map((dropin) => ({ type: dropin.type })),
    components: deps.provider.introspection.supportedComponents().map((component) => ({
      type: component.type,
      ...(component.subtypes ? { subtypes: component.subtypes } : {}),
    })),
    express: [],
  };
}
