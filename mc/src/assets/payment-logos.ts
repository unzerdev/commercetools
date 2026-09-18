/**
 * The bundled Unzer payment-method logos, keyed by the vendor's own method-type code — the
 * `availablePaymentTypes` value the keypair catalogue returns and the connector carries as
 * `paymentMethodCode`.
 *
 * The artwork lives as SVG files under `assets/images/logos`, one per method type, all drawn on the same
 * 40x24 canvas so every tile in the methods list keeps identical proportions. Importing them turns each
 * into a `data:` URL (`svg-url-loader`), which is what the `<img>` in `payment-method-logo` renders: the
 * app makes no remote image request (CSP + SSRF), and no artwork is duplicated as hand-pasted base64 in
 * source, as the previous five-logo set was.
 *
 * Keys are LOWERCASE and looked up case-insensitively — Unzer writes one of its codes as `EPS` while the
 * rest are lowercase, and a merchant's stored config may carry either spelling.
 *
 * {@link fallbackPaymentLogo} is deliberately NOT one of the keys: it belongs to no method code, and the
 * map is asserted to contain nothing but real ones.
 */
import unzer from './images/logos/unzer.svg';
import alipay from './images/logos/alipay.svg';
import applepay from './images/logos/applepay.svg';
import bancontact from './images/logos/bancontact.svg';
import card from './images/logos/card.svg';
import eps from './images/logos/EPS.svg';
import googlepay from './images/logos/googlepay.svg';
import ideal from './images/logos/ideal.svg';
import klarna from './images/logos/klarna.svg';
import openbankingPis from './images/logos/openbanking-pis.svg';
import paylaterDirectDebit from './images/logos/paylater-direct-debit.svg';
import paylaterInstallment from './images/logos/paylater-installment.svg';
import paylaterInvoice from './images/logos/paylater-invoice.svg';
import paypal from './images/logos/paypal.svg';
import payu from './images/logos/payu.svg';
import postFinanceCard from './images/logos/post-finance-card.svg';
import postFinanceEfinance from './images/logos/post-finance-efinance.svg';
import prepayment from './images/logos/prepayment.svg';
import przelewy24 from './images/logos/przelewy24.svg';
import sepaDirectDebit from './images/logos/sepa-direct-debit.svg';
import twint from './images/logos/twint.svg';
import wechatpay from './images/logos/wechatpay.svg';
import wero from './images/logos/wero.svg';

export const paymentLogos: Record<string, string> = {
  alipay,
  applepay,
  bancontact,
  card,
  eps,
  googlepay,
  ideal,
  klarna,
  'openbanking-pis': openbankingPis,
  'paylater-direct-debit': paylaterDirectDebit,
  'paylater-installment': paylaterInstallment,
  'paylater-invoice': paylaterInvoice,
  paypal,
  payu,
  'post-finance-card': postFinanceCard,
  'post-finance-efinance': postFinanceEfinance,
  prepayment,
  przelewy24,
  'sepa-direct-debit': sepaDirectDebit,
  twint,
  wechatpay,
  wero,
};

/**
 * The tile for a method type this release has no artwork for — a code Unzer adds after it. The catalogue
 * is DRIVEN BY THE PROVIDER, so an unknown code is expected rather than exceptional, and it still has to
 * render as a payment method: the Unzer mark on the same 40x24 canvas says "this is an Unzer method we do
 * not have a logo for", where an initial-letter tile only said "something is missing".
 */
export const fallbackPaymentLogo: string = unzer;
