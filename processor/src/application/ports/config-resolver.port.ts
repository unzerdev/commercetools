import type { EnvironmentMode, StoreConfig } from '../../domain';

/** The resolved, layered `StoreConfig` a provider receives, plus the deployment store-key rule. */
export interface ConfigResolver {
  /** `mode` forces the active environment, e.g. to read a non-active environment's catalogue. */
  resolve(storeKey: string, mode?: EnvironmentMode): Promise<StoreConfig>;

  /** The no-store default: the merchant-authored default scope. */
  resolveDefault(): Promise<StoreConfig>;

  /** The deployment store key: the CT project key. */
  storeKey(): string;
}
