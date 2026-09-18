import { createHash } from 'node:crypto';
import type { CtTransactionType, Money } from '../contracts';

const MAX_LENGTH = 30;
const PREFIX_BUDGET = 4;
const SHORT_BUDGET = 12;
const AMOUNT_BUDGET = 5;

/** The brand prefix reduced to lowercase alphanumerics; lowercase because references are matched by prefix. */
const alphanumericOnly = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** A deterministic base36 digest of `value`, exactly `width` characters wide. */
const base36Digest = (value: string, width: number): string => {
  const digest = BigInt(`0x${createHash('sha256').update(value).digest('hex')}`);

  return (digest % 36n ** BigInt(width)).toString(36).padStart(width, '0');
};

/** `<brandPrefix>-<ctPaymentId-digest>`: the part a payment's reference and its operations' names share. */
const referenceStem = (brandPrefix: string, ctPaymentId: string): string =>
  `${alphanumericOnly(brandPrefix).slice(0, PREFIX_BUDGET)}-${base36Digest(ctPaymentId, SHORT_BUDGET)}`;

/**
 * The `merchantReference` of a CT Payment: `<brandPrefix>-<digest of the full payment id>`, at most 30 chars
 * of `[A-Za-z0-9-]`. A digest rather than a slice, so two payments cannot collide on a shared id prefix.
 */
export const mintMerchantReference = (brandPrefix: string, ctPaymentId: string): string => {
  if (!ctPaymentId) {
    throw new Error('mintMerchantReference: ctPaymentId is required to mint a merchantReference.');
  }

  return referenceStem(brandPrefix, ctPaymentId).slice(0, MAX_LENGTH);
};

const OPERATION_CODE: Record<CtTransactionType, string> = {
  Authorization: 'A',
  Charge: 'C',
  Refund: 'R',
  CancelAuthorization: 'X',
};

const operationReferenceStem = (
  brandPrefix: string,
  ctPaymentId: string,
  operation: CtTransactionType,
  amount: Money,
): string =>
  `${referenceStem(brandPrefix, ctPaymentId)}-${OPERATION_CODE[operation]}${base36Digest(
    `${amount.centAmount}:${amount.currencyCode}`,
    AMOUNT_BUDGET,
  )}`;

const VERSION_BUDGET = MAX_LENGTH - (PREFIX_BUDGET + 1 + SHORT_BUDGET + 1 + 1 + AMOUNT_BUDGET);

const OPERATION_TAIL = new RegExp(`^[0-9a-z]{${AMOUNT_BUDGET}}\\d{1,${VERSION_BUDGET}}$`);

/**
 * The name of one modification: `<stem>-<op><amount-digest><paymentVersion>`. It is the vendor idempotency
 * key, so everything that separates two operations (payment, kind, version, money) is in the name.
 */
export const mintOperationReference = (
  brandPrefix: string,
  ctPaymentId: string,
  paymentVersion: number,
  operation: CtTransactionType,
  amount: Money,
): string => {
  if (!ctPaymentId) {
    throw new Error('mintOperationReference: ctPaymentId is required to name an operation.');
  }
  if (!Number.isInteger(paymentVersion) || paymentVersion < 0 || `${paymentVersion}`.length > VERSION_BUDGET) {
    throw new Error(
      `mintOperationReference: paymentVersion must be an integer of at most ${VERSION_BUDGET} digits, got ${paymentVersion}.`,
    );
  }

  return `${operationReferenceStem(brandPrefix, ctPaymentId, operation, amount)}${paymentVersion}`;
};

/** Whether `candidate` is a name this minter gave an operation on this payment: exact stem, mint-shaped tail. */
export const isMintedOperationReference = (
  brandPrefix: string,
  ctPaymentId: string,
  operation: CtTransactionType,
  candidate: string,
): boolean => {
  if (!ctPaymentId) {
    return false;
  }
  const stem = `${referenceStem(brandPrefix, ctPaymentId)}-${OPERATION_CODE[operation]}`;

  return candidate.startsWith(stem) && OPERATION_TAIL.test(candidate.slice(stem.length));
};
