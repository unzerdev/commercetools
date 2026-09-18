import type { ProviderModule } from '../../../handlers';
import type { CorePorts } from '../../../ports';

/** What every orchestrator receives: the commercetools ports and the active provider. */
export interface OrchestrationDeps {
  ports: CorePorts;
  provider: ProviderModule;
}
