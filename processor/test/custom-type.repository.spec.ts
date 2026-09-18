/**
 * `config/custom-type.repository` — the ONE custom-type operation the connect-payments-sdk does not
 * offer: removing a field definition the declaration no longer carries.
 *
 * WHY RAW: `ctCustomTypeService.createOrUpdate` is additive only. Its own source says so — it emits
 * `addFieldDefinition` for a missing field and lists "remove field definition if they no longer exist in
 * the TypeDraft" under *not supported yet* — so a field deleted from the declaration keeps standing in
 * every project the connector was ever deployed to, rendering as an empty column on the Merchant
 * Center's Payment page forever.
 *
 * Mocks the raw apiRoot `types()` builder chain the repository uses:
 *   client.types().withKey({ key }).get().execute()          // read the registered type + version
 *   client.types().withKey({ key }).post({ body }).execute() // removeFieldDefinition actions
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../src/infrastructure/bootstrap/payment-sdk';
import { pruneUndeclaredFields } from '../src/infrastructure/commercetools/custom-types';

interface Captured {
  getExecute: jest.Mock<() => Promise<unknown>>;
  postBody?: { version: number; actions: { action: string; fieldName?: string }[] };
  postExecute: jest.Mock<() => Promise<unknown>>;
  key?: string;
}

function mockTypes(): Captured {
  const captured: Captured = {
    getExecute: jest.fn<() => Promise<unknown>>(),
    postExecute: jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: {} }),
  };
  const builder = {
    withKey: (args: { key: string }) => {
      captured.key = args.key;
      return {
        get: () => ({ execute: captured.getExecute }),
        post: (post: { body: Captured['postBody'] }) => {
          captured.postBody = post.body;
          return { execute: captured.postExecute };
        },
      };
    },
  };
  jest.spyOn(paymentSDK.ctAPI.client, 'types').mockReturnValue(builder as never);
  return captured;
}

/** The registered type as commercetools holds it. */
const registered = (names: string[], version = 4): { body: unknown } => ({
  body: { key: 'psp-payment', version, fieldDefinitions: names.map((name) => ({ name })) },
});

/** The ownership rule the payment-type caller passes: the connector owns its `psp*` names. */
const ownsPspField = (fieldName: string): boolean => fieldName.startsWith('psp');

describe('config/custom-type.repository — pruning a field the declaration dropped', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes exactly the owned fields the declaration no longer carries, in ONE request', async () => {
    const captured = mockTypes();
    captured.getExecute.mockResolvedValue(
      registered(['pspPaymentId', 'pspHostedCheckoutId', 'pspReturnMac', 'inReview']),
    );

    const { removed } = await pruneUndeclaredFields('psp-payment', ['pspPaymentId', 'inReview'], ownsPspField);

    expect(removed).toEqual(['pspHostedCheckoutId', 'pspReturnMac']);
    expect(captured.key).toBe('psp-payment');
    // One post carrying both removals, under the version just read.
    expect(captured.postExecute).toHaveBeenCalledTimes(1);
    expect(captured.postBody).toEqual({
      version: 4,
      actions: [
        { action: 'removeFieldDefinition', fieldName: 'pspHostedCheckoutId' },
        { action: 'removeFieldDefinition', fieldName: 'pspReturnMac' },
      ],
    });
  });

  // The prune runs on every deploy, so the ordinary case is "nothing to do" — and it must cost no write.
  it('writes nothing when the registered type carries only declared fields', async () => {
    const captured = mockTypes();
    captured.getExecute.mockResolvedValue(registered(['pspPaymentId', 'inReview']));

    const { removed, retained } = await pruneUndeclaredFields(
      'psp-payment',
      ['pspPaymentId', 'inReview'],
      ownsPspField,
    );

    expect(removed).toEqual([]);
    expect(retained).toEqual([]);
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  /**
   * A commercetools Type is a PROJECT resource: an operator with `manage_types` can add a field to it from
   * the Merchant Center, so an undeclared field is not necessarily one this connector retired. Removing it
   * would destroy its values on every resource of the type with no way back, so an unowned name is reported
   * as `retained` and left standing.
   */
  it('leaves an undeclared field the ownership rule does not claim, and reports it', async () => {
    const captured = mockTypes();
    captured.getExecute.mockResolvedValue(registered(['pspPaymentId', 'merchantAnnotation']));

    const { removed, retained } = await pruneUndeclaredFields('psp-payment', ['pspPaymentId'], ownsPspField);

    expect(removed).toEqual([]);
    expect(retained).toEqual(['merchantAnnotation']);
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  // A deploy that retires one of the connector's own fields while a merchant extension is also present must
  // do both jobs in one pass: remove the retired name, keep the foreign one.
  it('removes an owned field and retains a foreign one in the same prune', async () => {
    const captured = mockTypes();
    captured.getExecute.mockResolvedValue(registered(['pspPaymentId', 'pspReturnMac', 'merchantAnnotation']));

    const { removed, retained } = await pruneUndeclaredFields('psp-payment', ['pspPaymentId'], ownsPspField);

    expect(removed).toEqual(['pspReturnMac']);
    expect(retained).toEqual(['merchantAnnotation']);
    expect(captured.postBody?.actions).toEqual([{ action: 'removeFieldDefinition', fieldName: 'pspReturnMac' }]);
  });

  // A field the declaration carries and the type does not is `createOrUpdate`'s job, not this one's:
  // the prune only ever removes, and must never read a MISSING field as a reason to write.
  it('ignores a declared field the registered type does not have', async () => {
    const captured = mockTypes();
    captured.getExecute.mockResolvedValue(registered(['pspPaymentId']));

    const { removed } = await pruneUndeclaredFields('psp-payment', ['pspPaymentId', 'pspBrandNewField'], ownsPspField);

    expect(removed).toEqual([]);
    expect(captured.postExecute).not.toHaveBeenCalled();
  });

  // Version-CAS with a bounded retry, as `payment.repository` does: a concurrent write bumps the version,
  // so the type is re-read and the removals re-posted rather than lost.
  it('re-reads and re-posts when a concurrent write bumped the version', async () => {
    const captured = mockTypes();
    captured.getExecute
      .mockResolvedValueOnce(registered(['pspPaymentId', 'pspReturnMac'], 4))
      .mockResolvedValueOnce(registered(['pspPaymentId', 'pspReturnMac'], 5));
    captured.postExecute
      .mockRejectedValueOnce({ statusCode: 409, body: { errors: [{ code: 'ConcurrentModification' }] } })
      .mockResolvedValueOnce({ body: {} });

    const { removed } = await pruneUndeclaredFields('psp-payment', ['pspPaymentId'], ownsPspField);

    expect(removed).toEqual(['pspReturnMac']);
    expect(captured.postExecute).toHaveBeenCalledTimes(2);
    expect(captured.postBody?.version).toBe(5);
  });
});
