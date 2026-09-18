/**
 * The money-path fixtures' one load-bearing guarantee: a leg the spec author did not name is still a
 * DISTINCT leg.
 *
 * The guards these fixtures exist to exercise are arithmetic over leg ids — `changeReservedLeg` selects the
 * leg to write by type + `interactionId` and reads a twin off exactly those two — so a fixture that minted
 * one id for two legs would hand the guard a false twin and the spec would ratify the defect instead of
 * catching it. Two partial captures of the same amount are an ordinary payment, so this cannot be left to
 * the author remembering.
 */
import { describe, expect, test } from '@jest/globals';
import { leg, VENDOR_PAYMENT_ID } from './support/payment-fixtures';

describe('the leg fixture', () => {
  test('two legs of the same type, state and amount are still two legs — distinct id and interactionId', () => {
    const first = leg('Charge', 'Success', 300);
    const second = leg('Charge', 'Success', 300);

    expect(second.id).not.toBe(first.id);
    expect(second.interactionId).not.toBe(first.interactionId);
  });

  test('legs differing only in state do not share an interactionId', () => {
    expect(leg('Charge', 'Pending', 300).interactionId).not.toBe(leg('Charge', 'Success', 300).interactionId);
  });

  test('the Authorization leg carries the vendor PAYMENT id — the id the connector really stamps on it', () => {
    expect(leg('Authorization', 'Success', 1000).interactionId).toBe(VENDOR_PAYMENT_ID);
  });

  test('an explicitly named leg keeps its name', () => {
    expect(leg('Refund', 'Pending', 400, 'op-77').interactionId).toBe('op-77');
  });
});
