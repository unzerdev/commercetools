import type { MethodSurfaceTraits, WalletData, WalletDataInput } from '../../../domain';

/** What a method's checkout surface needs, answered per method code without a vendor call. */
export interface MethodSurface {
  traits(code: string): MethodSurfaceTraits;

  /** The wallet sheet payload; `undefined` for every non-wallet method. */
  walletData(code: string, input: WalletDataInput): WalletData | undefined;
}
