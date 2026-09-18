/** How the connector identifies itself to the vendor. */
export interface ConnectorIdentity {
  /** Who built the connector (the npm `author`). */
  creator: string;
  /** The distribution's cart-extension label. */
  name: string;
  version: string;
}
