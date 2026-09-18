import type { ConfigResolver } from '../../application/ports';
import type { EnvironmentMode, StoreConfig } from '../../domain';
import { resolveStoreKey } from '../config/store-key';
import { resolveDefaultStoreConfig, resolveStoreConfig } from '../config/resolve-store-config';

/** `ConfigResolver` over the layered resolver. */
export class ConfigResolverAdapter implements ConfigResolver {
  public resolve(storeKey: string, mode?: EnvironmentMode): Promise<StoreConfig> {
    return resolveStoreConfig(storeKey, mode);
  }

  public resolveDefault(): Promise<StoreConfig> {
    return resolveDefaultStoreConfig();
  }

  public storeKey(): string {
    return resolveStoreKey();
  }
}
