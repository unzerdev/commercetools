import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MethodLogos } from '../../../application/handlers';
import type { MethodLogoBytes } from '../../../domain';
import { isOfferableMethod } from './offerable';

/**
 * `paymentMethodCode` -> the bundled SVG that draws it. The map is the allow-list: a request names a code, the
 * code is looked up here and only a hit is served, so no caller-supplied string ever reaches the filesystem.
 */
const METHOD_LOGO_FILES: Readonly<Record<string, string>> = {
  alipay: 'alipay.svg',
  applepay: 'applepay.svg',
  bancontact: 'bancontact.svg',
  card: 'card.svg',
  eps: 'EPS.svg',
  googlepay: 'googlepay.svg',
  ideal: 'ideal.svg',
  klarna: 'klarna.svg',
  'openbanking-pis': 'openbanking-pis.svg',
  'paylater-direct-debit': 'paylater-direct-debit.svg',
  'paylater-installment': 'paylater-installment.svg',
  'paylater-invoice': 'paylater-invoice.svg',
  paypal: 'paypal.svg',
  payu: 'payu.svg',
  'post-finance-card': 'post-finance-card.svg',
  'post-finance-efinance': 'post-finance-efinance.svg',
  prepayment: 'prepayment.svg',
  przelewy24: 'przelewy24.svg',
  'sepa-direct-debit': 'sepa-direct-debit.svg',
  twint: 'twint.svg',
  wechatpay: 'wechatpay.svg',
  wero: 'wero.svg',
};

const METHOD_LOGO_CONTENT_TYPE = 'image/svg+xml';

/** The artwork sits beside the compiled module: the build copies `assets/logos` into `dist` next to it. */
const LOGO_DIR = join(__dirname, '..', 'assets', 'logos');

function methodLogoFile(code: string): string | undefined {
  return METHOD_LOGO_FILES[code.toLowerCase()];
}

/** The provider's artwork surface; a file the deployment does not carry answers like an unknown code. */
export const pspMethodLogos: MethodLogos = {
  has: (code: string): boolean => isOfferableMethod(code) && methodLogoFile(code) !== undefined,

  async read(code: string): Promise<MethodLogoBytes | undefined> {
    const file = methodLogoFile(code);
    if (!file) {
      return undefined;
    }
    try {
      return { contentType: METHOD_LOGO_CONTENT_TYPE, data: await readFile(join(LOGO_DIR, file)) };
    } catch {
      return undefined;
    }
  },
};
