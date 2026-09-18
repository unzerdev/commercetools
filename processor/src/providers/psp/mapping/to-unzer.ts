import type { BasketLine, FollowUpAction, StoreConfig } from '../../../domain';
import { toDecimalAmount, type UnzerBasket, type UnzerMetadata } from '../client';

/** A redirect follow-up action when a URL is present, else `none`. */
export function redirectAction(url: string | null | undefined): FollowUpAction {
  return url ? { kind: 'redirect', payload: { url } } : { kind: 'none' };
}

/**
 * The bank-transfer instructions a pay-by-transfer method answers with, off the vendor's `processing` block.
 * `undefined` unless an IBAN is present; `shortId` travels alongside as the shared statement reference.
 */
export function transferInstructions(processing: Record<string, unknown> | undefined): FollowUpAction | undefined {
  const text = (key: string): string | undefined => {
    const value = processing?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const iban = text('iban');
  if (!iban) {
    return undefined;
  }
  return {
    kind: 'display',
    payload: {
      instruction: 'bank-transfer',
      iban,
      ...(text('holder') ? { holder: text('holder') } : {}),
      ...(text('bic') ? { bic: text('bic') } : {}),
      ...(text('descriptor') ? { descriptor: text('descriptor') } : {}),
      ...(text('shortId') ? { shortId: text('shortId') } : {}),
    },
  };
}

/** The metadata resource body identifying this integration to Unzer support. No `shopVersion`: commercetools is versionless. */
export function toUnzerMetadata(cfg: StoreConfig): UnzerMetadata {
  return {
    shopType: 'commercetools',
    pluginType: `${cfg.connector.creator}/${cfg.connector.name}`,
    pluginVersion: cfg.connector.version,
    integrator: cfg.integrator,
  };
}

/**
 * The basket resource body from the neutral lines; amounts leave as decimal strings here. `vat` is sent
 * unconditionally because the vendor refuses an item without it.
 */
export function toUnzerBasket(
  lines: BasketLine[],
  totalGrossCents: number,
  currencyCode: string,
  fractionDigits: number,
  orderId: string,
): UnzerBasket {
  return {
    totalValueGross: toDecimalAmount(totalGrossCents, fractionDigits),
    currencyCode,
    orderId,
    basketItems: lines.map((line, index) => ({
      basketItemReferenceId: `line-${index}`,
      title: line.title,
      quantity: line.quantity,
      amountPerUnitGross: toDecimalAmount(line.amountPerUnitGross, fractionDigits),
      amountDiscountPerUnitGross: toDecimalAmount(line.amountDiscountPerUnitGross, fractionDigits),
      vat: line.vat,
      ...(line.type ? { type: line.type } : {}),
    })),
  };
}
