/**
 * The logo tile that fronts a payment method, in priority order: the merchant's own upload (served by the
 * processor from its own origin), else the bundled artwork for the method code, else the Unzer mark.
 *
 * The default artwork is BUNDLED rather than fetched (CSP + SSRF), per method code; a code this release has
 * no logo for falls back to the Unzer mark, because the catalogue is the provider's and unknown codes are
 * ordinary. Only the merchant's own upload is remote, and only because the merchant put it there.
 */

import {
  fallbackPaymentLogo,
  paymentLogos,
} from '../../../../../assets/payment-logos';

/**
 * The bundled logo for a method code, or `undefined` when none is bundled. Matched case-insensitively:
 * Unzer spells one of its codes `EPS` and the rest lowercase. Callers that must render something use
 * {@link fallbackPaymentLogo}; this stays undefined-on-miss so a caller can still tell the two apart.
 */
export const paymentLogoFor = (code: string): string | undefined =>
  paymentLogos[code.toLowerCase()];

export type PaymentMethodLogoProps = {
  /** The processor payment-method code the logo represents. */
  code: string;
  /** The method's display name — the image `alt`. */
  name: string;
  /**
   * The logo url the PROCESSOR serves for this method code. It wins over the bundled artwork:
   * it comes from the release the connector is actually running, so the tile cannot show a drawing this
   * MC build happens to carry for a method the connector serves differently.
   */
  url?: string;
};

const PaymentMethodLogo = ({ code, name, url }: PaymentMethodLogoProps) => (
  <img
    className="unzer-pm-logo"
    src={url ?? paymentLogoFor(code) ?? fallbackPaymentLogo}
    alt={name}
  />
);
PaymentMethodLogo.displayName = 'PaymentMethodLogo';

export default PaymentMethodLogo;
