/**
 * The CT Payment shapes and merchant-intent bodies the money-path specs share.
 *
 * They live here rather than in each spec because the guards under test are ARITHMETIC over these very
 * legs: a spec that quietly redefined "authorized 1500, captured 1000, refunded 400" would be asserting
 * a headroom nobody else means. One fixture, one meaning — and a leg the state machine would refuse can
 * only be written on purpose.
 */
import { fakePayment } from './fake-provider-module';

/**
 * The store the panel's payments belong to — deliberately NOT the deployment's own
 * (`DEPLOYMENT_STORE_KEY`), so a route that fell back to the deployment key would fail the spec.
 */
export const PAYMENT_STORE_KEY = 'store-b';

export const eur = (centAmount: number) => ({ centAmount, currencyCode: 'EUR' });

/**
 * The vendor's id for the PAYMENT — what the connector writes to `interfaceId`, and what
 * `create-payment.ts` also stamps on the Authorization leg's `interactionId`.
 */
export const VENDOR_PAYMENT_ID = 'vendor-pay-1';

/** Distinguishes legs a spec did not name — see {@link leg}. */
let legSequence = 0;

/**
 * One CT transaction leg, carrying the vendor id the connector really stamps on it: the vendor PAYMENT id
 * on the Authorization leg (`create-payment.ts` writes `interactionId: result.providerPaymentId`), a vendor
 * OPERATION id on any settled modification. A leg with NO `interactionId` is a shape production never
 * writes — and `changeReservedLeg`'s leg lookup and duplicate guard are arithmetic over exactly these ids,
 * so a fixture without them cannot witness a guard that reads them wrong.
 *
 * Every unnamed leg gets its OWN id: two partial captures of the same amount are an ordinary payment, and a
 * fixture that minted one id for both would hand the duplicate guard a false twin — the spec would then
 * ratify the very defect it exists to catch. The Authorization leg is the one exception, and deliberately
 * so: it carries the vendor PAYMENT id because that is what the connector stamps on it, and a payment has
 * exactly one.
 */
export const leg = (type: string, state: string, centAmount: number, interactionId?: string) => {
  legSequence += 1;
  const mintedId = type === 'Authorization' ? VENDOR_PAYMENT_ID : `vendor-${type}-${centAmount}-${legSequence}`;

  return {
    id: `${type}-${state}-${centAmount}-${legSequence}`,
    type,
    state,
    amount: eur(centAmount),
    interactionId: interactionId ?? mintedId,
  };
};

/**
 * A connector payment of {@link PAYMENT_STORE_KEY} — the `storeKey` custom field is the ownership test
 * the action path derives its store from — planned at 1000 EUR and carrying exactly the given legs.
 */
export const ownedPayment = (transactions: unknown[], overrides: Record<string, unknown> = {}): any =>
  fakePayment({
    id: 'pay-1',
    interfaceId: VENDOR_PAYMENT_ID,
    amountPlanned: { ...eur(1000), type: 'centPrecision', fractionDigits: 2 },
    transactions,
    custom: { fields: { storeKey: PAYMENT_STORE_KEY } },
    ...overrides,
  });

/**
 * A connector payment part-way through its life: 1500 authorized, 1000 captured, 400 of that refunded.
 * So 500 is left to capture and 600 left to refund — the two headrooms the guards are judged against.
 */
export const partlySettledPayment = (overrides: Record<string, unknown> = {}): any =>
  ownedPayment([leg('Authorization', 'Success', 1500), leg('Charge', 'Success', 1000), leg('Refund', 'Success', 400)], {
    amountPlanned: { ...eur(1500), type: 'centPrecision', fractionDigits: 2 },
    ...overrides,
  });

export const captureAction = (centAmount: number) => ({ action: 'capturePayment' as const, amount: eur(centAmount) });
export const refundAction = (centAmount: number) => ({ action: 'refundPayment' as const, amount: eur(centAmount) });
export const cancelAction = { action: 'cancelPayment' as const };
export const reverseAction = { action: 'reversePayment' as const };

/** The request bodies the intent routes take — exactly one action each, as the contract requires. */
export const captureIntent = (centAmount: number) => ({ actions: [captureAction(centAmount)] });
export const refundIntent = (centAmount: number) => ({ actions: [refundAction(centAmount)] });
export const cancelIntent = { actions: [cancelAction] };
export const reverseIntent = { actions: [reverseAction] };
