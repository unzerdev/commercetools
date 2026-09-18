/** The vendor payload a wallet surface is handed; `payload` is passed to the vendor setter verbatim. */
export interface WalletData {
  kind: 'applepay' | 'googlepay';
  payload: Record<string, unknown>;
}
