/**
 * How a payment-method CODE becomes something an operator reads: a product name and a logo.
 *
 * The code the panel receives is the connector's own (`openbanking-pis`, `sepa-direct-debit`) — a
 * routing key, not a name. Both answers here are best-effort by design: a code the connector gains
 * after this release must still render, as its raw code and without artwork, rather than crash or
 * show an empty frame.
 */
import { Fragment, useState } from 'react';
import { useIntl, type IntlShape } from 'react-intl';
import { NO_VALUE_FALLBACK } from '@commercetools-frontend/constants';
import messages from './messages';

/**
 * The connector's method codes → their product names. Keys mirror `METHOD_TRANSACTION_SUPPORT` in the
 * processor (`providers/psp/supported-methods.ts`), which is the set of codes a payment can carry.
 * Brand names are not translated, but they live in the message catalogue with everything else so a
 * locale that DOES localize one ("Card", "Prepayment", the paylater family) has somewhere to put it.
 */
const methodMessages = {
  card: messages.method_card,
  paypal: messages.method_paypal,
  wero: messages.method_wero,
  applepay: messages.method_applepay,
  googlepay: messages.method_googlepay,
  klarna: messages.method_klarna,
  'paylater-invoice': messages.method_paylater_invoice,
  'paylater-installment': messages.method_paylater_installment,
  'paylater-direct-debit': messages.method_paylater_direct_debit,
  'installment-secured': messages.method_installment_secured,
  'invoice-secured': messages.method_invoice_secured,
  alipay: messages.method_alipay,
  bancontact: messages.method_bancontact,
  clicktopay: messages.method_clicktopay,
  EPS: messages.method_EPS,
  ideal: messages.method_ideal,
  'openbanking-pis': messages.method_openbanking_pis,
  payu: messages.method_payu,
  'post-finance-card': messages.method_post_finance_card,
  'post-finance-efinance': messages.method_post_finance_efinance,
  prepayment: messages.method_prepayment,
  przelewy24: messages.method_przelewy24,
  'sepa-direct-debit': messages.method_sepa_direct_debit,
  twint: messages.method_twint,
  wechatpay: messages.method_wechatpay,
} as const;

/** The method's product name, or the raw code when the connector names one this release does not. */
export const methodLabel = (intl: IntlShape, code: string): string =>
  code in methodMessages
    ? intl.formatMessage(methodMessages[code as keyof typeof methodMessages])
    : code;

/**
 * The processor's own asset URL for a method's logo, or `undefined` when this view was built without
 * a processor origin.
 *
 * `GET /assets/method-logo/{code}` serves all 22 shipped logos, is public (no auth) and answers 404
 * for a code it has no artwork for — so a method added to the connector costs one SVG in the
 * processor and nothing here. The route's `:code` never touches a path: it is looked up in a fixed
 * map, which IS the allowlist.
 */
export const methodLogoUrl = (
  externalApiUrl: string | undefined,
  code: string
): string | undefined =>
  externalApiUrl
    ? `${externalApiUrl.replace(
        /\/+$/,
        ''
      )}/assets/method-logo/${encodeURIComponent(code)}`
    : undefined;

export type MethodCellProps = {
  /** The commercetools payment method code; absent on a payment that never named one. */
  code?: string;
  /** The processor origin, for the asset route. */
  externalApiUrl?: string;
};

/**
 * The method as the panel shows it: logo beside product name.
 *
 * The logo has ONE source — the processor's asset route. An artwork that does not load (the route
 * ships none for this code, or the operator's browser cannot reach that origin even though the MC
 * gateway can) drops the image entirely rather than leaving a broken frame; the NAME never depends on
 * it, so the cell is still complete. `onError` is what detects that, because it is the only thing that
 * can: a probe cannot know in advance which of the two failures applies.
 */
const MethodCell = ({ code, externalApiUrl }: MethodCellProps) => {
  const intl = useIntl();
  const [logoFailed, setLogoFailed] = useState(false);

  if (!code) {
    return <Fragment>{NO_VALUE_FALLBACK}</Fragment>;
  }

  const logo = logoFailed ? undefined : methodLogoUrl(externalApiUrl, code);

  return (
    <span className="unzer-method">
      {logo ? (
        <img
          className="unzer-method__logo"
          data-testid="unzer-method-logo"
          src={logo}
          // Decorative: the product NAME sits beside it, so an alt text would announce the method twice.
          alt=""
          onError={() => setLogoFailed(true)}
        />
      ) : null}
      {methodLabel(intl, code)}
    </span>
  );
};
MethodCell.displayName = 'MethodCell';

export default MethodCell;
