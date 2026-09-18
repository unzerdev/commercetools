import type { EnvironmentMode, StoreConfig } from '../../../domain';

/** The connection input every vendor call runs on: the environment, its host pair, the key pair, the deadline. */
export interface PspConnectionConfig {
  mode: EnvironmentMode;
  hosts: { sandbox: string; live: string };
  credentials: { publicKey: string; privateKey: string };
  requestTimeoutMs: number;
}

/** Project a resolved `StoreConfig` onto the connection input; only the two keys are read off the credentials bag. */
export function toPspConnectionConfig(cfg: StoreConfig): PspConnectionConfig {
  return {
    mode: cfg.mode,
    hosts: cfg.vendorHosts,
    credentials: {
      publicKey: cfg.credentials.publicKey ?? '',
      privateKey: cfg.credentials.privateKey ?? '',
    },
    requestTimeoutMs: cfg.requestTimeoutMs,
  };
}
