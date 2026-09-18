import type { PspConnectionConfig } from '../connection';
import type { PspTransport } from '../transport';
import { type KeypairResult, parseKeypairResponse } from '../responses/keypair';

/** The keypair resource surface a test can stand in for. */
export interface KeypairApi {
  validate(cfg: PspConnectionConfig): Promise<KeypairResult>;
}

export class KeypairResource implements KeypairApi {
  constructor(private readonly transport: PspTransport) {}

  /** `GET /v1/keypair/types`: a 2xx proves the private key; the body carries the catalogue and the account's public key. */
  public async validate(cfg: PspConnectionConfig): Promise<KeypairResult> {
    return parseKeypairResponse(await this.transport.send(cfg, { method: 'GET', path: '/v1/keypair/types' }));
  }
}
