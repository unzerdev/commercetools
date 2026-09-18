import type { MethodSurface } from '../../../application/handlers';
import type { MethodSurfaceTraits, WalletData, WalletDataInput } from '../../../domain';
import { buildWalletData, surfaceTraits } from '../methods';

/** The static per-method surface facts the shopper config carries, read from the method tables. */
export class PspMethodSurface implements MethodSurface {
  traits(code: string): MethodSurfaceTraits {
    return surfaceTraits(code);
  }

  walletData(code: string, input: WalletDataInput): WalletData | undefined {
    return buildWalletData(code, input);
  }
}
