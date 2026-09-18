import type { MethodSurfaceTraits } from '../../../domain';
import { isWalletMethod } from './wallets';

/** Codes whose charge requires a described payer (the buy-now-pay-later family). */
export const CUSTOMER_DATA_METHOD_CODES: ReadonlySet<string> = new Set<string>([
  'klarna',
  'paylater-invoice',
  'paylater-installment',
  'paylater-direct-debit',
  'installment-secured',
  'invoice-secured',
]);

/** Codes whose answer ends in bank-transfer instructions the checkout must show. Prepayment alone. */
const TRANSFER_INSTRUCTION_METHOD_CODES: ReadonlySet<string> = new Set<string>(['prepayment']);

/** Codes whose surface needs the purchase's amount, currency and country before it can be paid with. */
const AMOUNT_DATA_METHOD_CODES: ReadonlySet<string> = new Set<string>(['paylater-installment']);

/** The one method Click to Pay rides on. */
const CLICK_TO_PAY_HOST_CODE = 'card';

/** Whether the method's charge requires a described customer. */
export function requiresCustomerData(code: string): boolean {
  return CUSTOMER_DATA_METHOD_CODES.has(code);
}

/** Whether the method's answer ends in transfer instructions the checkout must show. */
export function showsTransferInstructions(code: string): boolean {
  return TRANSFER_INSTRUCTION_METHOD_CODES.has(code.toLowerCase());
}

/** Whether the method's surface needs the purchase figures on mount. */
export function needsAmountData(code: string): boolean {
  return AMOUNT_DATA_METHOD_CODES.has(code);
}

/** Whether the surface draws its own pay button: the wallets, whose platform sheets open only from their own button. */
export function rendersOwnPayButton(code: string): boolean {
  return isWalletMethod(code);
}

/** Whether Click to Pay rides on this method's surface: the card, and nothing else. */
export function carriesClickToPay(code: string): boolean {
  return code.toLowerCase() === CLICK_TO_PAY_HOST_CODE;
}

/** The four static surface traits of a method, answered together. */
export function surfaceTraits(code: string): MethodSurfaceTraits {
  return {
    requiresCustomerData: requiresCustomerData(code),
    needsAmountData: needsAmountData(code),
    rendersOwnPayButton: rendersOwnPayButton(code),
    carriesClickToPay: carriesClickToPay(code),
  };
}
